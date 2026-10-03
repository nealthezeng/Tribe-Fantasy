import { stageMultiplier } from './decay';
import { autoPick } from './picks';
import { rankSnapshot, TIE_EPSILON } from './points';
import { athleteWeekScore, type StatLine } from './scoring';
import type { SeasonSettings } from './settings';
import { meetingKey, swissPairings, type Pairing } from './swiss';
import { mergeTaps, type Tap } from './taps';
import { tirednessMultiplier } from './tiredness';
import { pairKey, scoreWeek, type SideResult } from './week';

export interface YearMember { id: string; createdAt: string }
export interface YearStatLine { sessionId: string; athleteId: string; stats: Record<string, number>; pointsPlayed: number }
/** Confirmed injuries only; unconfirmed reports have no game effect. */
export interface YearInjury { athleteId: string; confirmedAt: string; clearedAt: string | null }
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

/** One row of public.games. Times are ISO. */
export interface TournamentGame {
  id: string;
  stageId: string;
  number: number;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface TournamentPairing { gameId: string; home: string; away: string | null }
export interface TournamentSlot { stageId: string; membershipId: string; athleteId: string; price: number; bench: boolean }
/** Keyed by game number, not game id: a pick can exist before its game does (pre-selection). */
export interface TournamentPick { stageId: string; number: number; membershipId: string; athleteId: string }
export interface TournamentSwap { stageId: string; membershipId: string; outAthlete: string; inAthlete: string; fromGame: number }
export interface TournamentSession { id: string; verifiedAt: string | null }

/** Everything for ONE league of one season. `now` is epoch ms. */
export interface TournamentInput {
  settings: SeasonSettings;
  now: number;
  games: TournamentGame[];
  pairings: TournamentPairing[];
  members: YearMember[];
  slots: TournamentSlot[];
  picks: TournamentPick[];
  swaps: TournamentSwap[];
  sessions: TournamentSession[];
  statLines: YearStatLine[];
  injuries: YearInjury[];
  /** The stage whose next game `next` describes (the pick screen's stage); null = no `next`. */
  currentStageId: string | null;
}

/**
 * upcoming: paired, not started. live: started, not finished. pending: waiting on locked stats or an earlier game.
 * void: started but its session was deleted (scores nothing, holds nothing back).
 */
export type GameStatus = 'upcoming' | 'live' | 'pending' | 'final' | 'void';
/** Why the athlete who plays isn't the manager's own pick. */
export type GameNotice = 'missed' | 'injured' | 'inactive';

export interface TournamentSide {
  membershipId: string;
  /** The manager's pick as made; null if none (or sealed: others' picks are hidden until the game starts). */
  picked: string | null;
  /** Who plays (or would, if the game started now). Null = forfeit. */
  athleteId: string | null;
  notice: GameNotice | null;
  active: string[];
  bench: string[];
  /** Tiredness factor per active athlete for this game. */
  rest: Record<string, number>;
  /** Factors for `athleteId`; null on a forfeit. */
  tired: number | null;
  decay: number | null;
  /** Set on final games only. */
  athleteScore: number | null;
  score: number | null;
  delta: number | null;
  result: 'W' | 'L' | 'T' | null;
}
export interface GameMatchup { home: TournamentSide; away: TournamentSide | null }
export interface GameOutcome { game: TournamentGame; status: GameStatus; matchups: GameMatchup[] }
export interface NextGame { stageId: string; number: number; sides: TournamentSide[] }
export interface TournamentResult { games: GameOutcome[]; standings: YearStanding[]; next: NextGame | null }

const ms = Date.parse;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Tournament mode §2: plays the league's year game by game from league-readable rows. Pure and deterministic.
 * `provisional`: a started game counts as final whatever its stats' lock or whether it has been finished yet
 * (for pairing only, never shown).
 */
export function scoreTournaments(input: TournamentInput, opts: { provisional?: boolean } = {}): TournamentResult {
  const s = input.settings;
  const { now } = input;
  const lockMs = s.stat_lock_hours * 3_600_000;
  const sessions = new Map(input.sessions.map((x) => [x.id, x]));
  const isLocked = (id: string) => {
    const v = sessions.get(id)?.verifiedAt ?? null;
    return v !== null && ms(v) + lockMs <= now;
  };
  // Started games in the order they were played, then the ones not started yet.
  const games = [...input.games].sort((a, b) =>
    a.startedAt !== null && b.startedAt !== null ? ms(a.startedAt) - ms(b.startedAt) || a.number - b.number
      : a.startedAt !== null ? -1 : b.startedAt !== null ? 1 : a.number - b.number || cmp(a.id, b.id));

  const linesBySession = new Map<string, StatLine[]>();
  for (const l of input.statLines) {
    const list = linesBySession.get(l.sessionId) ?? [];
    list.push({ athleteId: l.athleteId, sessionType: 'tournament', pointsPlayed: l.pointsPlayed, stats: l.stats });
    linesBySession.set(l.sessionId, list);
  }
  const injuredAt = (a: string, at: number) => input.injuries.some(
    (i) => i.athleteId === a && ms(i.confirmedAt) <= at && (i.clearedAt === null || ms(i.clearedAt) > at));

  // Auto-pick history: game scores from games final on their own locked stats, by when they settled (as M6).
  const settled: { settledAt: number; scores: Record<string, number> }[] = [];
  const athletes = [...new Set(input.slots.map((x) => x.athleteId))].sort();
  const historyAsOf = (asOf: number): Record<string, number[]> => {
    const h: Record<string, number[]> = {};
    for (const e of settled) if (e.settledAt <= asOf) for (const a of athletes) (h[a] ??= []).push(e.scores[a]);
    return h;
  };

  const lastStart = new Map<string, number>(); // `${stage}:${membership}:${athlete}` → game number
  const startedIn = new Map<string, Set<string>>(); // pairKey → stages with a start
  const table: Table = new Map(input.members.map((m) => [m.id, { points: 0, totalScore: 0, wins: 0, losses: 0, ties: 0 }]));

  /** One manager's side of game `number` in `stageId`, as of `asOf`. */
  const sideOf = (membershipId: string, stageId: string, number: number, asOf: number): TournamentSide => {
    const { active, bench } = lineup(input, membershipId, stageId, number);
    const rest: Record<string, number> = {};
    for (const a of active) {
      const last = lastStart.get(`${stageId}:${membershipId}:${a}`);
      rest[a] = tirednessMultiplier(last === undefined ? null : number - last, s);
    }
    const picked = input.picks.find((p) => p.stageId === stageId && p.number === number && p.membershipId === membershipId)
      ?.athleteId ?? null;
    let athleteId = picked;
    let notice: GameNotice | null = null;
    if (picked === null || !active.includes(picked) || injuredAt(picked, asOf)) {
      notice = picked === null ? 'missed' : active.includes(picked) ? 'injured' : 'inactive';
      const healthy = active.filter((a) => !injuredAt(a, asOf));
      athleteId = autoPick(healthy.length > 0 ? healthy : active, rest, historyAsOf(asOf), s);
    }
    const stages = athleteId === null ? null : startedIn.get(pairKey(membershipId, athleteId)) ?? new Set<string>();
    return {
      membershipId, picked, athleteId, notice, active, bench, rest,
      tired: athleteId === null ? null : rest[athleteId],
      decay: stages === null ? null : stageMultiplier([...stages].filter((x) => x !== stageId).length, s),
      athleteScore: null, score: null, delta: null, result: null,
    };
  };

  let blocked = false;
  const outcomes: GameOutcome[] = games.map((g) => {
    const sessionGone = g.sessionId === null || !sessions.has(g.sessionId);
    let status: GameStatus =
      g.startedAt === null ? 'upcoming'
        : sessionGone ? 'void'
          : isLocked(g.sessionId!) || (opts.provisional && g.startedAt !== null) ? 'final'
            : g.finishedAt === null ? 'live' : 'pending';
    const ownFinal = status !== 'void' && g.sessionId !== null && isLocked(g.sessionId);
    if (status === 'final' && blocked) status = 'pending';
    if (status === 'live' || status === 'pending') blocked = true;

    const asOf = g.startedAt === null ? now : ms(g.startedAt);
    const pairings = input.pairings.filter((p) => p.gameId === g.id)
      .sort((a, b) => cmp(a.home, b.home));
    const sides = new Map<string, TournamentSide>();
    for (const p of pairings) {
      for (const m of [p.home, p.away]) if (m !== null) sides.set(m, sideOf(m, g.stageId, g.number, asOf));
    }

    // A start counts for tiredness and degradation whatever happened in the game (spec §2), unless void.
    if (status !== 'upcoming' && status !== 'void') {
      for (const side of sides.values()) {
        if (side.athleteId === null) continue;
        lastStart.set(`${g.stageId}:${side.membershipId}:${side.athleteId}`, g.number);
        const key = pairKey(side.membershipId, side.athleteId);
        startedIn.set(key, (startedIn.get(key) ?? new Set()).add(g.stageId));
      }
    }

    if (status === 'final') {
      const members = input.members.filter((m) => ms(m.createdAt) <= asOf || sides.has(m.id)).map((m) => m.id).sort();
      settleGame(g, pairings, sides, linesBySession.get(g.sessionId!) ?? [], members, table, s);
    }
    if (ownFinal) {
      const lines = linesBySession.get(g.sessionId!) ?? [];
      const scores: Record<string, number> = {};
      for (const a of athletes) scores[a] = athleteWeekScore(lines.filter((l) => l.athleteId === a), s);
      settled.push({ settledAt: ms(sessions.get(g.sessionId!)!.verifiedAt!) + lockMs, scores });
    }

    const matchups = pairings.map((p) => ({ home: sides.get(p.home)!, away: p.away === null ? null : sides.get(p.away)! }));
    return { game: g, status, matchups };
  });

  let next: NextGame | null = null;
  if (input.currentStageId !== null) {
    const stageId = input.currentStageId;
    const number = 1 + Math.max(0, ...input.games.filter((g) => g.stageId === stageId && g.startedAt !== null).map((g) => g.number));
    const withRoster = [...new Set(input.slots.filter((x) => x.stageId === stageId).map((x) => x.membershipId))].sort();
    next = { stageId, number, sides: withRoster.map((m) => sideOf(m, stageId, number, now)) };
  }

  return { games: outcomes, standings: standingsOf(table), next };
}

type Table = Map<string, Omit<YearStanding, 'membershipId' | 'rank' | 'place' | 'tied'>>;

/** Scores a final game into `sides` (scores, results) and `table` (points, totals, W/L/T). */
function settleGame(g: TournamentGame, pairings: TournamentPairing[], sides: Map<string, TournamentSide>, lines: StatLine[],
  members: string[], table: Table, s: SeasonSettings): void {
  const multipliers: Record<string, number> = {};
  for (const x of sides.values()) {
    if (x.athleteId !== null) multipliers[pairKey(x.membershipId, x.athleteId)] = x.tired! * x.decay!;
  }
  const r = scoreWeek({
    settings: s,
    matchups: pairings.map((p, j) => ({ id: `${g.id}:${j}`, home: p.home, away: p.away })),
    picks: Object.fromEntries([...sides.values()].map((x) => [x.membershipId, x.athleteId])),
    statLines: lines,
    multipliers,
    standings: members.map((m) => ({ managerId: m, points: table.get(m)!.points, totalScore: table.get(m)!.totalScore })),
  });
  const apply = (sr: SideResult, other: SideResult | null) => {
    const result = other === null ? null
      : Math.abs(sr.score - other.score) < TIE_EPSILON ? 'T' : sr.score > other.score ? 'W' : 'L';
    Object.assign(sides.get(sr.managerId)!, { athleteScore: sr.athleteScore, score: sr.score, delta: sr.delta, result });
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

/** Standings by rank (ties share the average rank), then id. */
function standingsOf(table: Table): YearStanding[] {
  const rows = [...table.entries()].map(([managerId, r]) => ({ managerId, ...r }));
  const ranks = rankSnapshot(rows);
  return rows.map((r) => ({
    membershipId: r.managerId, points: r.points, totalScore: r.totalScore, wins: r.wins, losses: r.losses, ties: r.ties,
    rank: ranks[r.managerId],
    place: 1 + rows.filter((o) => o.points > r.points || (o.points === r.points && o.totalScore > r.totalScore)).length,
    tied: rows.some((o) => o !== r && o.points === r.points && o.totalScore === r.totalScore),
  })).sort((a, b) => a.rank - b.rank || cmp(a.membershipId, b.membershipId));
}

/**
 * Active and bench athletes of one manager for game `number`. Bench = the flagged slots when they number
 * min(bench_size, roster − 1), else the cheapest (ties → lowest id). A swap from game ≤ `number` trades places.
 */
export function lineup(input: Pick<TournamentInput, 'settings' | 'slots' | 'swaps'>, membershipId: string, stageId: string,
  number: number): { active: string[]; bench: string[] } {
  const slots = input.slots.filter((x) => x.stageId === stageId && x.membershipId === membershipId);
  const size = Math.min(input.settings.bench_size, Math.max(0, slots.length - 1));
  const flagged = slots.filter((x) => x.bench);
  let bench = (flagged.length === size ? flagged
    : [...slots].sort((a, b) => a.price - b.price || cmp(a.athleteId, b.athleteId)).slice(0, size)).map((x) => x.athleteId);
  let active = slots.map((x) => x.athleteId).filter((a) => !bench.includes(a));
  for (const w of input.swaps) {
    if (w.stageId !== stageId || w.membershipId !== membershipId || w.fromGame > number) continue;
    if (!active.includes(w.outAthlete) || !bench.includes(w.inAthlete)) continue;
    active = [...active.filter((a) => a !== w.outAthlete), w.inAthlete];
    bench = [...bench.filter((a) => a !== w.inAthlete), w.outAthlete];
  }
  return { active: active.sort(), bench: bench.sort() };
}

/** Stat lines from a session's live taps (merged as on the tally screen), for provisional standings. */
export function liveStatLines(sessionId: string, taps: Tap[], s: SeasonSettings): YearStatLine[] {
  const { counts } = mergeTaps(taps, s.tap_merge_seconds);
  return Object.entries(counts).sort(([a], [b]) => cmp(a, b))
    .map(([athleteId, stats]) => ({ sessionId, athleteId, stats, pointsPlayed: 0 }));
}

/**
 * Swiss pairings for the league's next game (spec §2): provisional standings, then `swissPairings` over the
 * members who have joined by `now`, counting meetings (and byes) in every started game of the year.
 * Callers pass verified lines where they exist and `liveStatLines` otherwise. Called while the game being
 * finished is still live (before `finish_game`), so that game counts too.
 */
export function nextPairings(input: TournamentInput): Pairing[] {
  const { order, meetings } = pairingInputs(input);
  return swissPairings(order, meetings);
}

/** What `nextPairings` feeds `swissPairings`: saved with the pairing so staff can re-run it (spec §7). */
export function pairingInputs(input: TournamentInput): { order: string[]; meetings: Record<string, number> } {
  const r = scoreTournaments(input, { provisional: true });
  const present = new Set(input.members.filter((m) => ms(m.createdAt) <= input.now).map((m) => m.id));
  const order = r.standings.filter((x) => present.has(x.membershipId))
    .sort((a, b) => b.points - a.points || b.totalScore - a.totalScore || cmp(a.membershipId, b.membershipId))
    .map((x) => x.membershipId);
  const started = new Set(input.games.filter((g) => g.startedAt !== null).map((g) => g.id));
  const meetings: Record<string, number> = {};
  for (const p of input.pairings) {
    if (!started.has(p.gameId)) continue;
    const k = meetingKey(p.home, p.away);
    meetings[k] = (meetings[k] ?? 0) + 1;
  }
  return { order, meetings };
}
