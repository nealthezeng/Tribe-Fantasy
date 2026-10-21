import { stageMultiplier } from './decay';
import { autoPick } from './picks';
import { rankSnapshot, TIE_EPSILON } from './points';
import { athleteWeekScore, type StatLine } from './scoring';
import type { SeasonSettings } from './settings';
import { meetingKey, swissPairings, type Pairing } from './swiss';
import { mergeTaps, type Tap } from './taps';
import { tirednessMultiplier } from './tiredness';
import { pairKey, scoreWeek, type SideResult } from './week';

/** `removedAt`: the account was removed (spec M14 §5.3); from then on the team forfeits every paired game and is left out of pairing. */
export interface YearMember { id: string; createdAt: string; removedAt: string | null }
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
  /** The real team our team played ("Duke"); display only, scoring ignores it. */
  opponent?: string | null;
}
export interface TournamentPairing { gameId: string; home: string; away: string | null }
/**
 * One team's buy in one player: `price` = credits paid, `share` = the part of him it owns (0, 1].
 * Counts for game n when `fromGame <= n` and (`untilGame` null or n < `untilGame`); a player can have an ended row and a live one.
 */
export interface TournamentSlot {
  stageId: string; membershipId: string; athleteId: string; price: number; share: number; fromGame: number; untilGame: number | null;
}
export const slotLive = (x: TournamentSlot, number: number): boolean => x.fromGame <= number && (x.untilGame === null || number < x.untilGame);
/** Keyed by game number, not game id: a pick can exist before its game does (pre-selection). One row per picked player. */
export interface TournamentPick { stageId: string; number: number; membershipId: string; athleteId: string }
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
  sessions: TournamentSession[];
  statLines: YearStatLine[];
  injuries: YearInjury[];
  /** The stage whose next game `next` describes (the pick screen's stage); null = no `next`. */
  currentStageId: string | null;
}

/**
 * upcoming: paired, not started. live: started, not finished. pending: waiting on verified stats or an earlier game.
 * void: started but its session was deleted (scores nothing, holds nothing back).
 */
export type GameStatus = 'upcoming' | 'live' | 'pending' | 'final' | 'void';
/** Why a starter isn't the manager's own pick. */
export type GameNotice = 'missed' | 'injured';
/** An empty or injured pick slot and who filled it (`picked` null = no pick; `athleteId` null = nobody, a forfeit). */
export interface Replacement { picked: string | null; athleteId: string | null; why: GameNotice }

export interface TournamentSide {
  membershipId: string;
  /** Own picks as made, sorted; [] if none (or sealed: others' picks are hidden until the game starts). */
  picked: string[];
  /** Who plays (or would, if the game started now): ≤ picks_per_game; [] = forfeit. */
  athleteIds: string[];
  /** One per pick slot that isn't playing as picked. */
  replacements: Replacement[];
  /** The whole roster this tournament, sorted. */
  players: string[];
  /** Per player: share owned, tiredness and degradation for this game, and factor = share × rest × decay (decision 11). */
  share: Record<string, number>;
  rest: Record<string, number>;
  decay: Record<string, number>;
  factor: Record<string, number>;
  /** Starters' raw game scores and athleteScore × factor; final games only. */
  athleteScores: Record<string, number> | null;
  points: Record<string, number> | null;
  score: number | null;
  delta: number | null;
  result: 'W' | 'L' | 'T' | null;
}
export interface GameMatchup { home: TournamentSide; away: TournamentSide | null }
export interface GameOutcome { game: TournamentGame; status: GameStatus; matchups: GameMatchup[] }
export interface NextGame { stageId: string; number: number; sides: TournamentSide[] }
export interface TournamentResult {
  games: GameOutcome[]; standings: YearStanding[]; next: NextGame | null;
  /** pairKey(manager, athlete) → stages in which that manager started that player (auto-picks included), sorted. */
  startedIn: Record<string, string[]>;
}

/** The factor a start in `stageId` carries for this pair: only starts in earlier tournaments count. */
export function repeatFactor(result: TournamentResult, membershipId: string, athleteId: string, stageId: string, s: SeasonSettings): number {
  const earlier = (result.startedIn[pairKey(membershipId, athleteId)] ?? []).filter((x) => x !== stageId);
  return stageMultiplier(earlier.length, s);
}

const ms = Date.parse;
/** True once a removal at `removedAt` (null = never removed) has happened by `at`. */
const removedBy = (removedAt: string | null, at: number): boolean => removedAt !== null && ms(removedAt) <= at;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Tournament mode §2: plays the league's year game by game from league-readable rows. Pure and deterministic.
 * `provisional`: a started game counts as final whether or not its stats are verified or whether it has been finished yet
 * (for pairing only, never shown).
 */
export function scoreTournaments(input: TournamentInput, opts: { provisional?: boolean } = {}): TournamentResult {
  const s = input.settings;
  const { now } = input;
  const sessions = new Map(input.sessions.map((x) => [x.id, x]));
  // A game counts once its stats are verified; the stat lock only governs reopen/corrections (t122).
  const isVerified = (id: string) => {
    const v = sessions.get(id)?.verifiedAt ?? null;
    return v !== null && ms(v) <= now;
  };
  // Started games in the order they were played, then the ones not started yet.
  const games = [...input.games].sort((a, b) =>
    a.startedAt !== null && b.startedAt !== null ? ms(a.startedAt) - ms(b.startedAt) || a.number - b.number
      : a.startedAt !== null ? -1 : b.startedAt !== null ? 1 : a.number - b.number || cmp(a.id, b.id));

  const linesBySession = new Map<string, StatLine[]>();
  for (const l of input.statLines) {
    const list = linesBySession.get(l.sessionId) ?? [];
    list.push({ athleteId: l.athleteId, pointsPlayed: l.pointsPlayed, stats: l.stats });
    linesBySession.set(l.sessionId, list);
  }
  const injuredAt = (a: string, at: number) => input.injuries.some(
    (i) => i.athleteId === a && ms(i.confirmedAt) <= at && (i.clearedAt === null || ms(i.clearedAt) > at));

  // Auto-pick history: game scores from games final on their own verified stats, by when they settled (as M6).
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

  const removedAtOf = new Map(input.members.map((m) => [m.id, m.removedAt]));
  const isRemoved = (id: string, at: number) => removedBy(removedAtOf.get(id) ?? null, at);

  /** One manager's side of game `number` in `stageId`, as of `asOf`. */
  const sideOf = (membershipId: string, stageId: string, number: number, asOf: number): TournamentSide => {
    const players = isRemoved(membershipId, asOf) ? [] : rosterOf(input, membershipId, stageId, number);
    const share: Record<string, number> = {};
    for (const x of input.slots) if (x.stageId === stageId && x.membershipId === membershipId && slotLive(x, number)) share[x.athleteId] = x.share;
    const rest: Record<string, number> = {};
    const decay: Record<string, number> = {};
    const factor: Record<string, number> = {};
    for (const a of players) {
      const last = lastStart.get(`${stageId}:${membershipId}:${a}`);
      rest[a] = tirednessMultiplier(last === undefined ? null : number - last, s);
      decay[a] = stageMultiplier([...startedIn.get(pairKey(membershipId, a)) ?? []].filter((x) => x !== stageId).length, s);
      factor[a] = share[a] * rest[a] * decay[a];
    }
    const picked = input.picks.filter((p) => p.stageId === stageId && p.number === number && p.membershipId === membershipId)
      .map((p) => p.athleteId).sort();
    // Own picks play unless injured at the start; a pick off the roster is ignored. Empty slots are auto-picked (C4).
    const mine = picked.filter((a) => players.includes(a));
    const athleteIds = mine.filter((a) => !injuredAt(a, asOf)).slice(0, s.picks_per_game);
    const injured = mine.filter((a) => injuredAt(a, asOf));
    const replacements: Replacement[] = [];
    const history = historyAsOf(asOf);
    for (let i = athleteIds.length; i < Math.min(s.picks_per_game, players.length); i++) {
      const free = players.filter((a) => !athleteIds.includes(a));
      const healthy = free.filter((a) => !injuredAt(a, asOf));
      const athleteId = autoPick(healthy.length > 0 ? healthy : free, rest, history, s, share);
      const was = injured.shift() ?? null;
      replacements.push({ picked: was, athleteId, why: was === null ? 'missed' : 'injured' });
      if (athleteId !== null) athleteIds.push(athleteId);
    }
    return {
      membershipId, picked, athleteIds, replacements, players, share, rest, decay, factor,
      athleteScores: null, points: null, score: null, delta: null, result: null,
    };
  };

  let blocked = false;
  const outcomes: GameOutcome[] = games.map((g) => {
    const sessionGone = g.sessionId === null || !sessions.has(g.sessionId);
    let status: GameStatus =
      g.startedAt === null ? 'upcoming'
        : sessionGone ? 'void'
          : isVerified(g.sessionId!) || (opts.provisional && g.startedAt !== null) ? 'final'
            : g.finishedAt === null ? 'live' : 'pending';
    const ownFinal = status !== 'void' && g.sessionId !== null && isVerified(g.sessionId);
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
        for (const a of side.athleteIds) {
          lastStart.set(`${g.stageId}:${side.membershipId}:${a}`, g.number);
          const key = pairKey(side.membershipId, a);
          startedIn.set(key, (startedIn.get(key) ?? new Set()).add(g.stageId));
        }
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
      settled.push({ settledAt: ms(sessions.get(g.sessionId!)!.verifiedAt!), scores });
    }

    const matchups = pairings.map((p) => ({ home: sides.get(p.home)!, away: p.away === null ? null : sides.get(p.away)! }));
    return { game: g, status, matchups };
  });

  let next: NextGame | null = null;
  const stageGames = input.games.filter((g) => g.stageId === input.currentStageId);
  // Games exist from the start (unstarted until played): the tournament is over when every game is finished.
  const over = stageGames.length > 0 && stageGames.every((g) => g.finishedAt !== null);
  if (input.currentStageId !== null && !over) {
    const stageId = input.currentStageId;
    const number = 1 + Math.max(0, ...input.games.filter((g) => g.stageId === stageId && g.startedAt !== null).map((g) => g.number));
    const withRoster = [...new Set(input.slots.filter((x) => x.stageId === stageId && slotLive(x, number)).map((x) => x.membershipId))]
      .filter((m) => !isRemoved(m, now)).sort();
    next = { stageId, number, sides: withRoster.map((m) => sideOf(m, stageId, number, now)) };
  }

  const started = Object.fromEntries([...startedIn].map(([k, v]) => [k, [...v].sort()]));
  return { games: outcomes, standings: standingsOf(table), next, startedIn: started };
}

type Table = Map<string, Omit<YearStanding, 'membershipId' | 'rank' | 'place' | 'tied'>>;

/** Scores a final game into `sides` (scores, results) and `table` (points, totals, W/L/T). */
function settleGame(g: TournamentGame, pairings: TournamentPairing[], sides: Map<string, TournamentSide>, lines: StatLine[],
  members: string[], table: Table, s: SeasonSettings): void {
  const multipliers: Record<string, number> = {};
  for (const x of sides.values()) for (const a of x.athleteIds) multipliers[pairKey(x.membershipId, a)] = x.factor[a];
  const r = scoreWeek({
    settings: s,
    matchups: pairings.map((p, j) => ({ id: `${g.id}:${j}`, home: p.home, away: p.away })),
    picks: Object.fromEntries([...sides.values()].map((x) => [x.membershipId, x.athleteIds])),
    statLines: lines,
    multipliers,
    standings: members.map((m) => ({ managerId: m, points: table.get(m)!.points, totalScore: table.get(m)!.totalScore })),
  });
  const apply = (sr: SideResult, other: SideResult | null) => {
    const result = other === null ? null
      : Math.abs(sr.score - other.score) < TIE_EPSILON ? 'T' : sr.score > other.score ? 'W' : 'L';
    const points = Object.fromEntries(sr.athleteIds.map((a) => [a, sr.athleteScores[a] * sr.multipliers[a]]));
    Object.assign(sides.get(sr.managerId)!, { athleteScores: sr.athleteScores, points, score: sr.score, delta: sr.delta, result });
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

/** One manager's roster (every player they own a share of at game `number`) in `stageId`, sorted. */
export function rosterOf(input: Pick<TournamentInput, 'slots'>, membershipId: string, stageId: string, number: number): string[] {
  return [...new Set(input.slots.filter((x) => x.stageId === stageId && x.membershipId === membershipId && slotLive(x, number))
    .map((x) => x.athleteId))].sort();
}

/** Stat lines from a session's live taps (merged as on the tally screen), for provisional standings. */
export function liveStatLines(sessionId: string, taps: Tap[], s: SeasonSettings): YearStatLine[] {
  const { counts } = mergeTaps(taps, s.tap_merge_seconds);
  return Object.entries(counts).sort(([a], [b]) => cmp(a, b))
    .map(([athleteId, stats]) => ({ sessionId, athleteId, stats, pointsPlayed: 0 }));
}

/**
 * Swiss pairings for the league's next game (spec §2): provisional standings, then `swissPairings` over the
 * members who have joined by `now`, counting meetings (and byes) in this tournament's started games, then the season's (C11).
 * Callers pass verified lines where they exist and `liveStatLines` otherwise. Called while the game being
 * finished is still live (before `finish_game`), so that game counts too.
 */
export function nextPairings(input: TournamentInput): Pairing[] {
  const { order, meetings, seasonMeetings } = pairingInputs(input);
  return swissPairings(order, meetings, seasonMeetings);
}

/** What `nextPairings` feeds `swissPairings`: saved with the pairing so staff can re-run it (spec §7). */
export function pairingInputs(input: TournamentInput):
  { order: string[]; meetings: Record<string, number>; seasonMeetings: Record<string, number> } {
  const r = scoreTournaments(input, { provisional: true });
  const present = new Set(input.members.filter((m) => ms(m.createdAt) <= input.now && !removedBy(m.removedAt, input.now)).map((m) => m.id));
  const order = r.standings.filter((x) => present.has(x.membershipId))
    .sort((a, b) => b.points - a.points || b.totalScore - a.totalScore || cmp(a.membershipId, b.membershipId))
    .map((x) => x.membershipId);
  const started = new Map(input.games.filter((g) => g.startedAt !== null).map((g) => [g.id, g.stageId]));
  const meetings: Record<string, number> = {};
  const seasonMeetings: Record<string, number> = {};
  for (const p of input.pairings) {
    if (!started.has(p.gameId)) continue;
    const k = meetingKey(p.home, p.away);
    seasonMeetings[k] = (seasonMeetings[k] ?? 0) + 1;
    if (started.get(p.gameId) === input.currentStageId) meetings[k] = (meetings[k] ?? 0) + 1;
  }
  return { order, meetings, seasonMeetings };
}
