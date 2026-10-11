import { parseSettings, type SeasonSettings } from '../../core/settings';
import { swissPairings } from '../../core/swiss';
import {
  liveStatLines, pairingInputs, scoreTournaments, type TournamentInput, type TournamentResult,
} from '../../core/tournament';
import { rowToTap, type StatTapRow } from '../tally/queue';
import { AUCTION_STAGE_COLUMNS, pickPlayingStage, type AuctionStage } from './auction';
import { todayLocal } from './stats';
import { supabase } from './supabase';

export interface GameRow {
  id: string; stage_id: string; number: number; session_id: string | null; started_at: string | null; finished_at: string | null;
  opponent: string | null;
}
export const GAME_COLUMNS = 'id, stage_id, number, session_id, started_at, finished_at, opponent';
/** One pairing as open_tournament / finish_game take it. */
export interface GamePairing { league_id: string; home: string; away: string | null }
/** What one league's pairing was computed from (saved in the finish_game audit row). */
export interface LeaguePairingInput { league_id: string; order: string[]; meetings: Record<string, number> }
interface LineRow { session_id: string; athlete_id: string; stats: Record<string, number>; points_played: number }
interface InjuryRow { athlete_id: string; confirmed_at: string | null; cleared_at: string | null }

/** Rows as PostgREST returns them, for one league of one season. */
export interface TournamentRows {
  settings: unknown;
  stages: AuctionStage[];
  games: GameRow[];
  /** This league's pairings only. */
  pairings: { game_id: string; home: string; away: string | null }[];
  members: { id: string; team_name: string; created_at: string }[];
  slots: { stage_id: string; membership_id: string; athlete_id: string; price: number; bench: boolean }[];
  picks: { stage_id: string; game_number: number; membership_id: string; athlete_id: string }[];
  swaps: { stage_id: string; membership_id: string; out_athlete: string; in_athlete: string; from_game: number }[];
  /** Every session a game links to: a game whose session is missing is void. */
  sessions: { id: string; verified_at: string | null }[];
  lines: LineRow[];
  /** Taps of unverified game sessions (staff only), for provisional pairing. Empty otherwise. */
  taps: (StatTapRow & { session_id: string })[];
  injuries: InjuryRow[];
  athletes: { id: string; name: string }[];
}

/** The stage picks and Start game are for: its auction has run and its last day hasn't passed. Else none. */
function playingStage(stages: AuctionStage[], now: number): AuctionStage | null {
  const today = todayLocal(new Date(now));
  const s = pickPlayingStage(stages, today);
  return s && today <= s.ends_on ? s : null;
}

export function toTournamentInput(rows: TournamentRows, now: number): TournamentInput {
  const settings = parseSettings(rows.settings);
  const athletes = new Set(rows.athletes.map((a) => a.id));
  // Unverified sessions have no stat lines yet: their live taps stand in (only staff load them).
  const live = rows.sessions.filter((s) => s.verified_at === null).flatMap((s) =>
    liveStatLines(s.id, rows.taps.filter((t) => t.session_id === s.id).map(rowToTap), settings));
  return {
    settings,
    now,
    games: rows.games.map((g) => ({
      id: g.id, stageId: g.stage_id, number: g.number, sessionId: g.session_id, startedAt: g.started_at, finishedAt: g.finished_at, opponent: g.opponent,
    })),
    pairings: rows.pairings.map((p) => ({ gameId: p.game_id, home: p.home, away: p.away })),
    members: rows.members.map((m) => ({ id: m.id, createdAt: m.created_at })),
    slots: rows.slots.map((x) => ({ stageId: x.stage_id, membershipId: x.membership_id, athleteId: x.athlete_id, price: x.price, bench: x.bench })),
    picks: rows.picks.map((p) => ({ stageId: p.stage_id, number: p.game_number, membershipId: p.membership_id, athleteId: p.athlete_id })),
    swaps: rows.swaps.map((w) => ({
      stageId: w.stage_id, membershipId: w.membership_id, outAthlete: w.out_athlete, inAthlete: w.in_athlete, fromGame: w.from_game,
    })),
    sessions: rows.sessions.map((s) => ({ id: s.id, verifiedAt: s.verified_at })),
    statLines: [
      ...rows.lines.map((l) => ({ sessionId: l.session_id, athleteId: l.athlete_id, stats: l.stats, pointsPlayed: l.points_played })),
      ...live,
    ],
    // Injuries have no season column: keep this season's athletes, confirmed reports only.
    injuries: rows.injuries.filter((i) => i.confirmed_at !== null && athletes.has(i.athlete_id))
      .map((i) => ({ athleteId: i.athlete_id, confirmedAt: i.confirmed_at!, clearedAt: i.cleared_at })),
    // Between tournaments (last day past, or the next auction not run yet) there's nothing to pick.
    currentStageId: playingStage(rows.stages, now)?.id ?? null,
  };
}

export interface LeagueTournament {
  settings: SeasonSettings;
  input: TournamentInput;
  result: TournamentResult;
  team: Map<string, string>;
  athlete: Map<string, string>;
  stage: Map<string, string>;
  /** Each stage's dates, for the League header. */
  stageDates: Map<string, { starts_on: string; ends_on: string }>;
  /** Athletes with a confirmed injury that hasn't cleared. */
  injured: Set<string>;
}

export function buildLeagueTournament(rows: TournamentRows, now = Date.now()): LeagueTournament {
  const input = toTournamentInput(rows, now);
  return {
    settings: input.settings,
    input,
    result: scoreTournaments(input),
    team: new Map(rows.members.map((m) => [m.id, m.team_name])),
    athlete: new Map(rows.athletes.map((a) => [a.id, a.name])),
    stage: new Map(rows.stages.map((x) => [x.id, x.name])),
    stageDates: new Map(rows.stages.map((x) => [x.id, { starts_on: x.starts_on, ends_on: x.ends_on }])),
    injured: new Set(input.injuries.filter((i) => i.clearedAt === null || Date.parse(i.clearedAt) > now).map((i) => i.athleteId)),
  };
}

const PAGE = 1000; // PostgREST's default max rows

/** Every row, a page at a time. `page` must order by a unique key so pages don't overlap. */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}

/** A query's rows, or none when `q` is null (an `.in()` over an empty list). */
async function rowsOf<T>(q: PromiseLike<{ data: unknown; error: unknown }> | null): Promise<T[]> {
  if (!q) return [];
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

/**
 * Every row the league's year needs; RLS hides other teams' picks until each game starts. `taps` (staff only) adds the
 * live taps of unverified game sessions, for provisional pairing.
 */
export async function loadLeagueRows(seasonId: string, leagueId: string, { taps = false } = {}): Promise<TournamentRows> {
  const sb = supabase!;
  const [season, stages, members, slots, picks, injuries, athletes] = await Promise.all([
    rowsOf<{ settings: unknown }>(sb.from('seasons').select('settings').eq('id', seasonId)),
    rowsOf<AuctionStage>(sb.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId)),
    rowsOf<TournamentRows['members'][number]>(sb.from('memberships').select('id, team_name, created_at').eq('league_id', leagueId)),
    rowsOf<TournamentRows['slots'][number]>(sb.from('roster_slots').select('stage_id, membership_id, athlete_id, price, bench').eq('league_id', leagueId)),
    // ponytail: unpaged, fine below 1000 picks a league-year (6 teams × ~20 games).
    rowsOf<TournamentRows['picks'][number]>(sb.from('game_picks').select('stage_id, game_number, membership_id, athlete_id').eq('league_id', leagueId)),
    rowsOf<InjuryRow>(sb.from('injuries').select('athlete_id, confirmed_at, cleared_at').not('confirmed_at', 'is', null)),
    rowsOf<TournamentRows['athletes'][number]>(sb.from('athletes').select('id, name').eq('season_id', seasonId)),
  ]);
  if (season.length === 0) throw new Error('NOT_FOUND');
  const stageIds = stages.map((x) => x.id);
  const games = await rowsOf<GameRow>(stageIds.length ? sb.from('games').select(GAME_COLUMNS).in('stage_id', stageIds) : null);
  const gameIds = games.map((g) => g.id);
  const sessionIds = games.flatMap((g) => (g.session_id ? [g.session_id] : []));
  const [pairings, swaps, sessions] = await Promise.all([
    rowsOf<TournamentRows['pairings'][number]>(gameIds.length
      ? sb.from('game_pairings').select('game_id, home, away').eq('league_id', leagueId).in('game_id', gameIds) : null),
    rowsOf<TournamentRows['swaps'][number]>(stageIds.length
      ? sb.from('bench_swaps').select('stage_id, membership_id, out_athlete, in_athlete, from_game').in('stage_id', stageIds) : null),
    rowsOf<TournamentRows['sessions'][number]>(sessionIds.length ? sb.from('sessions').select('id, verified_at').in('id', sessionIds) : null),
  ]);
  const open = sessions.filter((s) => s.verified_at === null).map((s) => s.id);
  const [lines, tapRows] = await Promise.all([
    sessionIds.length
      ? fetchAll<LineRow>((from, to) => sb.from('stat_lines').select('session_id, athlete_id, stats, points_played')
        .in('session_id', sessionIds).order('session_id').order('athlete_id').range(from, to))
      : [],
    taps && open.length
      ? fetchAll<TournamentRows['taps'][number]>((from, to) => sb.from('stat_taps')
        .select('id, session_id, athlete_id, stat, keeper_id, tapped_at, undoes').in('session_id', open).order('id').range(from, to))
      : [],
  ]);
  return {
    settings: season[0].settings, stages, games, pairings, members, slots, picks, swaps, sessions, lines, taps: tapRows,
    injuries, athletes,
  };
}

export const loadLeagueTournament = async (seasonId: string, leagueId: string) =>
  buildLeagueTournament(await loadLeagueRows(seasonId, leagueId));

const leaguesOf = (seasonId: string) =>
  rowsOf<{ id: string; name: string }>(supabase!.from('leagues').select('id, name').eq('season_id', seasonId).order('name'));

/** The Swiss pairing of one league's inputs, in the shape the RPCs take. */
export const toPairings = (p: LeaguePairingInput): GamePairing[] =>
  swissPairings(p.order, p.meetings).map(([home, away]) => ({ league_id: p.league_id, home, away }));

/**
 * The next game's pairings for every league of the season, from provisional standings (live taps where a session
 * isn't verified, so the caller must be staff), with the inputs each was computed from.
 */
export async function seasonPairings(seasonId: string, now = Date.now()): Promise<{
  pairings: GamePairing[]; provisional: LeaguePairingInput[]; team: Map<string, string>; league: Map<string, string>;
}> {
  const leagues = await leaguesOf(seasonId);
  const loaded = await Promise.all(leagues.map(async (l) => ({ l, rows: await loadLeagueRows(seasonId, l.id, { taps: true }) })));
  const provisional = loaded.map(({ l, rows }) => ({ league_id: l.id, ...pairingInputs(toTournamentInput(rows, now)) }));
  return {
    pairings: provisional.flatMap(toPairings),
    provisional,
    team: new Map(loaded.flatMap(({ rows }) => rows.members.map((m) => [m.id, m.team_name] as const))),
    league: new Map(leagues.map((l) => [l.id, l.name])),
  };
}

/**
 * The tally's game: the newest game of the stage whose auction has run (null before its tournament opens). After the
 * stage's last day only a live game is returned, so it can still be finished; Start game is gone.
 */
export async function loadCurrentGame(seasonId: string, now = Date.now()): Promise<{ stage: AuctionStage; game: GameRow } | null> {
  const stages = await rowsOf<AuctionStage>(supabase!.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId));
  const stage = pickPlayingStage(stages, todayLocal(new Date(now)));
  if (!stage) return null;
  const [game] = await rowsOf<GameRow>(supabase!.from('games').select(GAME_COLUMNS).eq('stage_id', stage.id)
    .order('number', { ascending: false }).limit(1));
  if (!game) return null;
  const live = game.started_at !== null && game.finished_at === null;
  return live || playingStage([stage], now) ? { stage, game } : null;
}

/**
 * Staff "Check pairing" (spec §7): does re-running Swiss on the saved inputs give the saved pairings? It catches a
 * pairing that wasn't Swiss; it can't catch made-up standings (those are in the audit row to eyeball).
 */
export function checkPairing(details: { pairings: GamePairing[]; provisional: LeaguePairingInput[] }): boolean {
  if (!Array.isArray(details.pairings) || !Array.isArray(details.provisional)) return false;
  try {
    // Leagues are at most 8 teams. An order longer than that is junk and would hang the tab during exhaustive Swiss.
    if (details.provisional.some((p) => p.order.length > 8)) return false;
    // jsonb reorders object keys, so compare as plain strings.
    const key = (p: GamePairing) => `${p.league_id}:${p.home}:${p.away ?? ''}`;
    return details.provisional.flatMap(toPairings).map(key).join() === details.pairings.map(key).join();
  } catch {
    return false;
  }
}

/** 'Zeal vs Flow · Money has a bye' */
export const describePairings = (pairings: GamePairing[], team: Map<string, string>) => pairings
  .map((p) => (p.away === null ? `${team.get(p.home) ?? 'A team'} has a bye` : `${team.get(p.home) ?? 'A team'} vs ${team.get(p.away) ?? 'A team'}`))
  .join(' · ');

/**
 * Merge standings from all leagues. Pure function for testability. Unsettled: games of other stages that started
 * and aren't final yet (void and never-started games don't count).
 */
export function mergeRanks(results: TournamentResult[], stageId: string): { ranks: Record<string, number>; unsettled: number } {
  const ranks: Record<string, number> = {};
  const unsettled = new Set<string>();
  for (const result of results) {
    for (const row of result.standings) ranks[row.membershipId] = row.rank;
    for (const g of result.games) {
      if (g.game.stageId !== stageId && (g.status === 'live' || g.status === 'pending')) unsettled.add(g.game.id);
    }
  }
  return { ranks, unsettled: unsettled.size };
}

/** The allowance input for every league of the season: {membership: rank}, and how many games aren't final yet. */
export async function seasonRanks(seasonId: string, stageId: string): Promise<{ ranks: Record<string, number>; unsettled: number }> {
  const years = await Promise.all((await leaguesOf(seasonId)).map((l) => loadLeagueTournament(seasonId, l.id)));
  return mergeRanks(years.map((y) => y.result), stageId);
}

export interface OverallStanding {
  membershipId: string; team: string; league: string;
  points: number; totalScore: number; wins: number; losses: number; ties: number; place: number; tied: boolean;
}

/**
 * Leagues' standings as one ranked list, by the leagues' own rule: points, then total score; equal on both = tied.
 * Tied teams list by name, so one league's Standings and the all-leagues view order them alike (t226).
 */
export function mergeStandings(leagues: { name: string; y: Pick<LeagueTournament, 'result' | 'team'> }[]): OverallStanding[] {
  const rows = leagues.flatMap(({ name, y }) => y.result.standings.map(({ membershipId, points, totalScore, wins, losses, ties }) =>
    ({ membershipId, team: y.team.get(membershipId) ?? '', league: name, points, totalScore, wins, losses, ties })));
  const ahead = (o: typeof rows[number], r: typeof rows[number]) =>
    o.points > r.points || (o.points === r.points && o.totalScore > r.totalScore);
  return rows.map((r) => ({
    ...r,
    place: 1 + rows.filter((o) => ahead(o, r)).length,
    tied: rows.some((o) => o !== r && o.points === r.points && o.totalScore === r.totalScore),
  })).sort((a, b) => a.place - b.place || a.team.localeCompare(b.team) || a.league.localeCompare(b.league));
}

export const countLeagues = async (seasonId: string) => (await leaguesOf(seasonId)).length;

/** The all-leagues leaderboard of a season. `own` is a league already loaded on the page: not fetched again. */
export async function loadSeasonStandings(seasonId: string, own?: { leagueId: string; y: LeagueTournament }): Promise<OverallStanding[]> {
  const leagues = await leaguesOf(seasonId);
  const years = await Promise.all(leagues.map(async (l) =>
    ({ name: l.name, y: l.id === own?.leagueId ? own.y : await loadLeagueTournament(seasonId, l.id) })));
  return mergeStandings(years);
}
