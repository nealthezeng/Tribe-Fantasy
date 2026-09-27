import { stageMultiplier } from './decay';
import { availableAthletes, defaultPick, usedThisCycle, type PickRecord } from './picks';
import { rankSnapshot, TIE_EPSILON } from './points';
import { roundRobin } from './schedule';
import { athleteWeekScore, type StatLine } from './scoring';
import type { SeasonSettings, SessionType } from './settings';
import { pairKey, scoreWeek, type SideResult } from './week';

/** One row of public.weeks. Dates are YYYY-MM-DD; times are ISO. */
export interface YearWeek {
  id: string;
  stageId: string;
  startsOn: string;
  endsOn: string;
  startsAt: string;
  endsAt: string;
  pickLockAt: string;
}
export interface YearMember { id: string; createdAt: string }
export interface YearSlot { stageId: string; membershipId: string; athleteId: string }
export interface YearPick { weekId: string; membershipId: string; athleteId: string }
export interface YearSession { id: string; kind: SessionType; heldOn: string; counts: boolean; verifiedAt: string | null }
export interface YearStatLine { sessionId: string; athleteId: string; stats: Record<string, number>; pointsPlayed: number }
/** Confirmed injuries only; unconfirmed reports have no game effect. */
export interface YearInjury { athleteId: string; confirmedAt: string; clearedAt: string | null }

/** Everything for ONE league of one season. `now` is epoch ms. */
export interface YearInput {
  settings: SeasonSettings;
  now: number;
  weeks: YearWeek[];
  members: YearMember[];
  slots: YearSlot[];
  picks: YearPick[];
  sessions: YearSession[];
  statLines: YearStatLine[];
  injuries: YearInjury[];
}

/** open: before the lock. locked: lock passed, week not over. pending: over, waiting on stats or an earlier week. */
export type WeekStatus = 'open' | 'locked' | 'pending' | 'final' | 'skipped';
/** Why the athlete who plays isn't the manager's own pick. */
export type PickNotice = 'missed' | 'injured' | 'used';

export interface YearSide {
  membershipId: string;
  /** The manager's pick as made; null if none (or not visible yet: others' picks are sealed until the lock). */
  picked: string | null;
  /** Who plays (or would, if the lock were now). Null = forfeit. */
  athleteId: string | null;
  notice: PickNotice | null;
  /** The team's roster for this week's stage. */
  roster: string[];
  /** Roster athletes not yet used this cycle, as of this week's lock (the pick screen greys out the rest). */
  available: string[];
  /** Set on final weeks only. */
  athleteScore: number | null;
  multiplier: number | null;
  score: number | null;
  delta: number | null;
  result: 'W' | 'L' | 'T' | null;
}
export interface YearMatchup { home: YearSide; away: YearSide | null }
export interface WeekOutcome { week: YearWeek; index: number; status: WeekStatus; matchups: YearMatchup[] }
export interface YearStanding {
  membershipId: string;
  points: number;
  totalScore: number;
  wins: number;
  losses: number;
  ties: number;
  /** Average rank among ties (1 = best): what the allowance and rank weighting use. */
  rank: number;
  /** Display place: 1 + teams strictly ahead. */
  place: number;
  tied: boolean;
}
export interface YearResult { weeks: WeekOutcome[]; standings: YearStanding[] }

const ms = Date.parse;

/** M6 spec §2: plays the league's year week by week from league-readable rows. Pure and deterministic. */
export function scoreYear(input: YearInput): YearResult {
  const s = input.settings;
  const { now } = input;
  const weeks = [...input.weeks].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const lockMs = s.stat_lock_hours * 3_600_000;
  const isLocked = (x: YearSession) => x.verifiedAt !== null && ms(x.verifiedAt) + lockMs <= now;

  const linesBySession = new Map<string, YearStatLine[]>();
  for (const l of input.statLines) {
    const list = linesBySession.get(l.sessionId) ?? [];
    list.push(l);
    linesBySession.set(l.sessionId, list);
  }
  const counted = (w: YearWeek) =>
    input.sessions.filter((x) => x.counts && x.heldOn >= w.startsOn && x.heldOn <= w.endsOn);
  const statLinesOf = (sessions: YearSession[]): StatLine[] =>
    sessions.flatMap((x) => (linesBySession.get(x.id) ?? []).map((l) => ({
      athleteId: l.athleteId, sessionType: x.kind, pointsPlayed: l.pointsPlayed, stats: l.stats,
    })));
  const injuredAt = (a: string, at: number) => input.injuries.some(
    (i) => i.athleteId === a && ms(i.confirmedAt) <= at && (i.clearedAt === null || ms(i.clearedAt) > at));
  const injuredDuring = (a: string, w: YearWeek) => input.injuries.some(
    (i) => i.athleteId === a && ms(i.confirmedAt) < ms(w.endsAt) && (i.clearedAt === null || ms(i.clearedAt) > ms(w.startsAt)));

  // Default-pick history: entries for weeks final on their own data, gated by settledAt so a week that settles
  // (locks) after a later week's pick lock never feeds that later week's default pick (spec §2).
  const settled: { settledAt: number; scores: Record<string, number> }[] = [];
  const athletes = [...new Set(input.slots.map((x) => x.athleteId))];
  const historyAsOf = (asOf: number): Record<string, number[]> => {
    const h: Record<string, number[]> = {};
    for (const entry of settled) {
      if (entry.settledAt > asOf) continue;
      for (const a of athletes) (h[a] ??= []).push(entry.scores[a]);
    }
    return h;
  };

  const usedPicks = new Map<string, PickRecord[]>(); // `${stage}:${membership}` → starts that used the athlete
  const startedIn = new Map<string, Set<string>>(); // pairKey → stages in which the pair was a start
  const table = new Map<string, Omit<YearStanding, 'membershipId' | 'rank' | 'place' | 'tied'>>(
    input.members.map((m) => [m.id, { points: 0, totalScore: 0, wins: 0, losses: 0, ties: 0 }]));

  let blocked = false;
  const outcomes: WeekOutcome[] = weeks.map((w, index) => {
    const lock = ms(w.pickLockAt);
    const sessions = counted(w);
    const ended = now >= ms(w.endsAt);
    let status: WeekStatus =
      now < lock ? 'open'
        : !ended ? 'locked'
          : sessions.length === 0 ? 'skipped'
            : sessions.every(isLocked) ? 'final' : 'pending';
    const ownFinal = status === 'final';
    if (status === 'final' && blocked) status = 'pending';
    if (status !== 'final' && status !== 'skipped') blocked = true;

    const asOf = Math.min(now, lock);
    const members = input.members.filter((m) => ms(m.createdAt) <= lock).map((m) => m.id).sort();
    const weekLines = statLinesOf(sessions);
    const played = new Set(weekLines.map((l) => l.athleteId));

    // Effective picks, as of the lock (spec §2).
    const sides = new Map<string, YearSide>();
    for (const m of members) {
      const roster = input.slots.filter((x) => x.stageId === w.stageId && x.membershipId === m).map((x) => x.athleteId).sort();
      const used = usedThisCycle(m, roster, usedPicks.get(`${w.stageId}:${m}`) ?? [], index);
      const picked = input.picks.find((p) => p.weekId === w.id && p.membershipId === m)?.athleteId ?? null;
      const avail = availableAthletes(roster, used);
      let athleteId = picked;
      let notice: PickNotice | null = null;
      if (picked === null || !roster.includes(picked) || used.has(picked) || injuredAt(picked, asOf)) {
        notice = picked === null ? 'missed' : roster.includes(picked) && !used.has(picked) ? 'injured' : 'used';
        const healthy = avail.filter((a) => !injuredAt(a, asOf));
        athleteId = defaultPick(healthy.length > 0 ? healthy : avail, historyAsOf(asOf), s);
      }
      sides.set(m, {
        membershipId: m, picked, athleteId, notice, roster, available: avail,
        athleteScore: null, multiplier: null, score: null, delta: null, result: null,
      });
    }

    // Usage and degradation: a start counts once the lock has passed and the week wasn't skipped, unless the
    // athlete was injured during the week and has no counted stat line (only knowable once the week is over).
    const multipliers: Record<string, number> = {};
    for (const side of sides.values()) {
      if (side.athleteId === null) continue;
      const key = pairKey(side.membershipId, side.athleteId);
      const stages = startedIn.get(key) ?? new Set<string>();
      multipliers[key] = stageMultiplier([...stages].filter((st) => st !== w.stageId).length, s);
      const counts = status !== 'open' && status !== 'skipped'
        && !(ended && injuredDuring(side.athleteId, w) && !played.has(side.athleteId));
      if (!counts) continue;
      const k = `${w.stageId}:${side.membershipId}`;
      usedPicks.set(k, [...(usedPicks.get(k) ?? []), { week: index, managerId: side.membershipId, athleteId: side.athleteId }]);
      startedIn.set(key, stages.add(w.stageId));
    }

    const pairings = roundRobin(members, index + 1)[index] ?? [];
    if (status === 'final') {
      const r = scoreWeek({
        settings: s,
        matchups: pairings.map(([home, away], j) => ({ id: `${w.id}:${j}`, home, away })),
        picks: Object.fromEntries([...sides.values()].map((x) => [x.membershipId, x.athleteId])),
        statLines: weekLines,
        multipliers,
        standings: members.map((m) => ({ managerId: m, ...pick(table.get(m)!) })),
      });
      const apply = (sr: SideResult, other: SideResult | null) => {
        const side = sides.get(sr.managerId)!;
        const result = other === null ? null
          : Math.abs(sr.score - other.score) < TIE_EPSILON ? 'T' : sr.score > other.score ? 'W' : 'L';
        Object.assign(side, {
          athleteScore: sr.athleteScore, multiplier: sr.multiplier, score: sr.score, delta: sr.delta, result,
        });
        const row = table.get(sr.managerId)!;
        const after = r.standings.find((x) => x.managerId === sr.managerId)!;
        row.points = after.points;
        row.totalScore = after.totalScore;
        if (result === 'W') row.wins++;
        if (result === 'L') row.losses++;
        if (result === 'T') row.ties++;
      };
      for (const mt of r.matchups) {
        apply(mt.home, mt.away);
        if (mt.away) apply(mt.away, mt.home);
      }
    }
    if (ownFinal) {
      const settledAt = Math.max(ms(w.endsAt), ...sessions.map((x) => ms(x.verifiedAt!) + lockMs));
      const scores: Record<string, number> = {};
      for (const a of athletes) scores[a] = athleteWeekScore(weekLines.filter((l) => l.athleteId === a), s);
      settled.push({ settledAt, scores });
    }

    const matchups = pairings.map(([home, away]) => ({
      home: sides.get(home)!,
      away: away === null ? null : sides.get(away)!,
    }));
    return { week: w, index, status, matchups };
  });

  const rows = [...table.entries()].map(([membershipId, r]) => ({ managerId: membershipId, ...r }));
  const ranks = rankSnapshot(rows);
  const standings = rows.map((r) => {
    const place = 1 + rows.filter((o) => o.points > r.points || (o.points === r.points && o.totalScore > r.totalScore)).length;
    const tied = rows.some((o) => o !== r && o.points === r.points && o.totalScore === r.totalScore);
    return {
      membershipId: r.managerId, points: r.points, totalScore: r.totalScore, wins: r.wins, losses: r.losses, ties: r.ties,
      rank: ranks[r.managerId], place, tied,
    };
  }).sort((a, b) => a.rank - b.rank || a.membershipId.localeCompare(b.membershipId));
  return { weeks: outcomes, standings };
}

const pick = (r: { points: number; totalScore: number }) => ({ points: r.points, totalScore: r.totalScore });
