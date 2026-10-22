import { rawScore } from '../../core/scoring';
import { parseSettings, type SeasonSettings } from '../../core/settings';
import { swissPairings } from '../../core/swiss';
import {
  isOut, liveStatLines, pairingInputs, scoreTournaments, type GameOutcome, type TournamentInput, type TournamentResult,
} from '../../core/tournament';
import { rowToTap, type StatTapRow } from '../tally/queue';
import { AUCTION_STAGE_COLUMNS, auctionPhase, pickAuctionStage, pickPlayingStage, type AuctionStage } from './auction';
import { api } from './rpc';
import { todayLocal } from './stats';
import { supabase } from './supabase';

export const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
/** 2–1, or 2–1–1 with ties. */
export const record = (r: { wins: number; losses: number; ties: number }) => `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ''}`;

export interface GameRow {
  id: string; stage_id: string; number: number; session_id: string | null; started_at: string | null; finished_at: string | null;
  opponent: string | null;
}
export const GAME_COLUMNS = 'id, stage_id, number, session_id, started_at, finished_at, opponent';
/** One pairing as open_tournament / finish_game take it. */
export interface GamePairing { league_id: string; home: string; away: string | null }
/** What one league's pairing was computed from (saved in the finish_game audit row): this tournament's meetings, then the season's (C11). */
export interface LeaguePairingInput { league_id: string; order: string[]; meetings: Record<string, number>; season_meetings: Record<string, number> }
interface LineRow { session_id: string; athlete_id: string; stats: Record<string, number>; points_played: number }
interface InjuryRow { athlete_id: string; confirmed_at: string | null; cleared_at: string | null }

/** Rows as PostgREST returns them, for one league of one season. */
export interface TournamentRows {
  settings: unknown;
  stages: AuctionStage[];
  games: GameRow[];
  /** This league's pairings only. */
  pairings: { game_id: string; home: string; away: string | null }[];
  members: { id: string; team_name: string; created_at: string; removed_at: string | null; user_id?: string | null }[];
  /** The members' accounts' names. */
  profiles?: { id: string; display_name: string }[];
  slots: { stage_id: string; membership_id: string; athlete_id: string; price: number; share: number; from_game: number; until_game: number | null }[];
  picks: { stage_id: string; game_number: number; membership_id: string; athlete_id: string }[];
  /** Every session a game links to: a game whose session is missing is void. */
  sessions: { id: string; verified_at: string | null }[];
  lines: LineRow[];
  /** Taps of unverified game sessions: staff's, for provisional pairing, or `live` ones for unofficial scores. Empty otherwise. */
  taps: (StatTapRow & { session_id: string })[];
  injuries: InjuryRow[];
  /** Keeper Out marks of this season's stages (open: `until_game` null). */
  outs: { stage_id: string; athlete_id: string; from_game: number; until_game: number | null }[];
  athletes: { id: string; name: string }[];
}

/** The stage picks and Start game are for: its auction has run and its last day hasn't passed. Else none. */
function playingStage(stages: AuctionStage[], now: number): AuctionStage | null {
  const today = todayLocal(new Date(now));
  const s = pickPlayingStage(stages, today);
  return s && today <= s.ends_on ? s : null;
}

/** A team's name, marked when its account was removed. */
export const teamLabel = (m: { team_name: string; removed_at: string | null }): string =>
  m.removed_at === null ? m.team_name : `${m.team_name} (removed)`;

export function toTournamentInput(rows: TournamentRows, now: number): TournamentInput {
  const settings = parseSettings(rows.settings);
  const athletes = new Set(rows.athletes.map((a) => a.id));
  // Unverified sessions have no stat lines yet: their live taps stand in (staff and live readers load them).
  const live = rows.sessions.filter((s) => s.verified_at === null).flatMap((s) =>
    liveStatLines(s.id, rows.taps.filter((t) => t.session_id === s.id).map(rowToTap), settings));
  return {
    settings,
    now,
    games: rows.games.map((g) => ({
      id: g.id, stageId: g.stage_id, number: g.number, sessionId: g.session_id, startedAt: g.started_at, finishedAt: g.finished_at, opponent: g.opponent,
    })),
    pairings: rows.pairings.map((p) => ({ gameId: p.game_id, home: p.home, away: p.away })),
    members: rows.members.map((m) => ({ id: m.id, createdAt: m.created_at, removedAt: m.removed_at })),
    slots: rows.slots.map((x) => ({ stageId: x.stage_id, membershipId: x.membership_id, athleteId: x.athlete_id, price: x.price, share: x.share, fromGame: x.from_game, untilGame: x.until_game })),
    picks: rows.picks.map((p) => ({ stageId: p.stage_id, number: p.game_number, membershipId: p.membership_id, athleteId: p.athlete_id })),
    sessions: rows.sessions.map((s) => ({ id: s.id, verifiedAt: s.verified_at })),
    statLines: [
      ...rows.lines.map((l) => ({ sessionId: l.session_id, athleteId: l.athlete_id, stats: l.stats, pointsPlayed: l.points_played })),
      ...live,
    ],
    // Injuries have no season column: keep this season's athletes, confirmed reports only.
    injuries: rows.injuries.filter((i) => i.confirmed_at !== null && athletes.has(i.athlete_id))
      .map((i) => ({ athleteId: i.athlete_id, confirmedAt: i.confirmed_at!, clearedAt: i.cleared_at })),
    outs: rows.outs.map((o) => ({ stageId: o.stage_id, athleteId: o.athlete_id, fromGame: o.from_game, untilGame: o.until_game })),
    // Between tournaments (last day past, or the next auction not run yet) there's nothing to pick.
    currentStageId: playingStage(rows.stages, now)?.id ?? null,
  };
}

export interface LeagueTournament {
  settings: SeasonSettings;
  input: TournamentInput;
  result: TournamentResult;
  /** Unofficial outcomes (game id to outcome) of the games still live or pending, from their live taps; never in `result`. */
  unofficial: Map<string, GameOutcome>;
  team: Map<string, string>;
  /** membershipId → the owner's display name: "Removed user" once the account is gone, "" without a profile. */
  owner: Map<string, string>;
  athlete: Map<string, string>;
  stage: Map<string, string>;
  /** Each stage's dates, for the League header. */
  stageDates: Map<string, { starts_on: string; ends_on: string }>;
  /** Athletes Out for the next game (empty without one). */
  out: Set<string>;
}

export function buildLeagueTournament(rows: TournamentRows, now = Date.now()): LeagueTournament {
  const input = toTournamentInput(rows, now);
  const result = scoreTournaments(input);
  const next = result.next;
  // The same year with every started game counted: its sides carry the live scores. Skipped when nothing is open.
  const open = result.games.filter((g) => g.status === 'live' || g.status === 'pending');
  const provisional = open.length ? new Map(scoreTournaments(input, { provisional: true }).games.map((g) => [g.game.id, g])) : null;
  const unofficial = new Map(open.map((g) => [g.game.id, {
    game: g.game, status: g.status,
    matchups: provisional!.get(g.game.id)!.matchups.map(({ home, away }) => ({
      home: { ...home, delta: null, result: null }, away: away && { ...away, delta: null, result: null },
    })),
  }]));
  const names = new Map((rows.profiles ?? []).map((p) => [p.id, p.display_name]));
  return {
    settings: input.settings,
    input,
    result,
    unofficial,
    team: new Map(rows.members.map((m) => [m.id, teamLabel(m)])),
    owner: new Map(rows.members.map((m) => [m.id, m.user_id === null ? 'Removed user' : names.get(m.user_id ?? '') ?? ''])),
    athlete: new Map(rows.athletes.map((a) => [a.id, a.name])),
    stage: new Map(rows.stages.map((x) => [x.id, x.name])),
    stageDates: new Map(rows.stages.map((x) => [x.id, { starts_on: x.starts_on, ends_on: x.ends_on }])),
    out: new Set(next ? input.outs.map((o) => o.athleteId).filter((a) => isOut(input.outs, a, next.stageId, next.number)) : []),
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
export async function rowsOf<T>(q: PromiseLike<{ data: unknown; error: unknown }> | null): Promise<T[]> {
  if (!q) return [];
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

/** Live taps of started, unverified games (any league reader), one RPC per game, keepers named `k1`, `k2`, ... */
// ponytail: PostgREST max-rows (1000) silently caps each RPC result, so a game over 1000 taps loses its newest; page it with fetchAll + range if that grows.
export async function loadLiveTaps(games: { id: string; session_id: string | null }[]): Promise<TournamentRows['taps']> {
  const per = await Promise.all(games.filter((g) => g.session_id).map(async (g) =>
    (await api.liveGameTaps(g.id)).map((t) => ({
      id: t.id, session_id: g.session_id!, athlete_id: t.athlete_id, stat: t.stat, keeper_id: `k${t.keeper}`, tapped_at: t.tapped_at, undoes: t.undoes,
    }))));
  return per.flat();
}

/**
 * Every row the league's year needs; RLS hides other teams' picks until each game starts. `taps` (staff only) adds the
 * live taps of unverified game sessions, for provisional pairing. `live` (anyone) loads those taps through
 * live_game_taps instead, for the unofficial scores of started games; `taps` wins if both are set.
 */
export async function loadLeagueRows(seasonId: string, leagueId: string, { taps = false, live = false } = {}): Promise<TournamentRows> {
  const sb = supabase!;
  const [season, stages, members, slots, picks, injuries, athletes] = await Promise.all([
    rowsOf<{ settings: unknown }>(sb.from('seasons').select('settings').eq('id', seasonId)),
    rowsOf<AuctionStage>(sb.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId)),
    rowsOf<TournamentRows['members'][number]>(sb.from('memberships').select('id, team_name, created_at, removed_at, user_id').eq('league_id', leagueId)),
    rowsOf<TournamentRows['slots'][number]>(sb.from('roster_slots').select('stage_id, membership_id, athlete_id, price, share, from_game, until_game').eq('league_id', leagueId)),
    // ponytail: unpaged, fine below 1000 picks a league-year (12 teams × 2 picks × ~20 games ≈ 480); page it if that grows.
    rowsOf<TournamentRows['picks'][number]>(sb.from('game_picks').select('stage_id, game_number, membership_id, athlete_id').eq('league_id', leagueId)),
    rowsOf<InjuryRow>(sb.from('injuries').select('athlete_id, confirmed_at, cleared_at').not('confirmed_at', 'is', null)),
    rowsOf<TournamentRows['athletes'][number]>(sb.from('athletes').select('id, name').eq('season_id', seasonId)),
  ]);
  if (season.length === 0) throw new Error('NOT_FOUND');
  const userIds = members.flatMap((m) => (m.user_id ? [m.user_id] : []));
  const stageIds = stages.map((x) => x.id);
  const [games, outs] = await Promise.all([
    rowsOf<GameRow>(stageIds.length ? sb.from('games').select(GAME_COLUMNS).in('stage_id', stageIds) : null),
    rowsOf<TournamentRows['outs'][number]>(stageIds.length
      ? sb.from('outs').select('stage_id, athlete_id, from_game, until_game').in('stage_id', stageIds) : null),
  ]);
  const gameIds = games.map((g) => g.id);
  const sessionIds = games.flatMap((g) => (g.session_id ? [g.session_id] : []));
  const [pairings, sessions, profiles] = await Promise.all([
    rowsOf<TournamentRows['pairings'][number]>(gameIds.length
      ? sb.from('game_pairings').select('game_id, home, away').eq('league_id', leagueId).in('game_id', gameIds) : null),
    rowsOf<TournamentRows['sessions'][number]>(sessionIds.length ? sb.from('sessions').select('id, verified_at').in('id', sessionIds) : null),
    rowsOf<NonNullable<TournamentRows['profiles']>[number]>(userIds.length ? sb.from('profiles').select('id, display_name').in('id', userIds) : null),
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
      : live ? loadLiveTaps(games.filter((g) => g.started_at !== null && open.includes(g.session_id ?? ''))) : [],
  ]);
  return {
    settings: season[0].settings, stages, games, pairings, members, profiles, slots, picks, sessions, lines, taps: tapRows,
    injuries, outs, athletes,
  };
}

/** Who is Out right now in `stageId`: athlete → the `from_game` of the open row. */
export async function loadOpenOuts(stageId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase!.from('outs').select('athlete_id, from_game').eq('stage_id', stageId).is('until_game', null);
  if (error) throw error;
  return new Map((data ?? []).map((o) => [o.athlete_id as string, o.from_game as number]));
}

/** The stage players are marked Out for: the earliest whose last day hasn't passed (the playing one, else the next). */
export function outStage<T extends { starts_on: string; ends_on: string }>(stages: T[], today: string): T | null {
  return stages.filter((s) => s.ends_on >= today).sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0] ?? null;
}

export const loadLeagueTournament = async (seasonId: string, leagueId: string, opts: { live?: boolean } = {}) =>
  buildLeagueTournament(await loadLeagueRows(seasonId, leagueId, opts));

const leaguesOf = (seasonId: string) =>
  rowsOf<{ id: string; name: string }>(supabase!.from('leagues').select('id, name').eq('season_id', seasonId).order('name'));

/** One league's pairing inputs as finish_game saves them. */
export function leaguePairingInput(leagueId: string, input: TournamentInput): LeaguePairingInput {
  const { order, meetings, seasonMeetings } = pairingInputs(input);
  return { league_id: leagueId, order, meetings, season_meetings: seasonMeetings };
}

/** The Swiss pairing of one league's inputs, in the shape the RPCs take. */
export const toPairings = (p: LeaguePairingInput): GamePairing[] =>
  swissPairings(p.order, p.meetings, p.season_meetings ?? {}).map(([home, away]) => ({ league_id: p.league_id, home, away }));

/**
 * The next game's pairings for every league of the season, from provisional standings (live taps where a session
 * isn't verified, so the caller must be staff), with the inputs each was computed from.
 */
export async function seasonPairings(seasonId: string, now = Date.now()): Promise<{
  pairings: GamePairing[]; provisional: LeaguePairingInput[]; team: Map<string, string>; league: Map<string, string>;
}> {
  const leagues = await leaguesOf(seasonId);
  const loaded = await Promise.all(leagues.map(async (l) => ({ l, rows: await loadLeagueRows(seasonId, l.id, { taps: true }) })));
  const provisional = loaded.map(({ l, rows }) => leaguePairingInput(l.id, toTournamentInput(rows, now)));
  return {
    pairings: provisional.flatMap(toPairings),
    provisional,
    team: new Map(loaded.flatMap(({ rows }) => rows.members.map((m) => [m.id, teamLabel(m)] as const))),
    league: new Map(leagues.map((l) => [l.id, l.name])),
  };
}

/**
 * The tally's game: the stage's first unfinished game, or its last when all are finished (the "is over" line); null
 * before its tournament opens. `games` is every game of the stage by number, `count` how many. After the stage's last
 * day only a live game is returned, so it can still be finished; Start game is gone.
 */
export async function loadCurrentGame(seasonId: string, now = Date.now()): Promise<{ stage: AuctionStage; game: GameRow; games: GameRow[]; count: number } | null> {
  const stages = await rowsOf<AuctionStage>(supabase!.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId));
  const stage = pickPlayingStage(stages, todayLocal(new Date(now)));
  if (!stage) return null;
  const games = await rowsOf<GameRow>(supabase!.from('games').select(GAME_COLUMNS).eq('stage_id', stage.id).order('number'));
  const game = games.find((g) => g.finished_at === null) ?? games.at(-1);
  if (!game) return null;
  const live = game.started_at !== null && game.finished_at === null;
  return live || playingStage([stage], now) ? { stage, game, games, count: games.length } : null;
}

/**
 * Staff "Check pairing" (spec §7): does re-running Swiss on the saved inputs give the saved pairings? It catches a
 * pairing that wasn't Swiss; it can't catch made-up standings (those are in the audit row to eyeball).
 */
export function checkPairing(details: { pairings: GamePairing[]; provisional: LeaguePairingInput[] }): boolean {
  if (!Array.isArray(details.pairings) || !Array.isArray(details.provisional)) return false;
  try {
    // Leagues are at most 12 teams. An order longer than that is junk and would hang the tab during exhaustive Swiss.
    if (details.provisional.some((p) => p.order.length > 12)) return false;
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
  membershipId: string; team: string; owner: string; league: string;
  points: number; totalScore: number; wins: number; losses: number; ties: number; place: number; tied: boolean;
}

/**
 * Leagues' standings as one ranked list, by the leagues' own rule: points, then total score; equal on both = tied.
 * Tied teams list by name, so one league's Standings and the all-leagues view order them alike (t226).
 */
export function mergeStandings(leagues: { name: string; y: Pick<LeagueTournament, 'result' | 'team' | 'owner'> }[]): OverallStanding[] {
  const rows = leagues.flatMap(({ name, y }) => y.result.standings.map(({ membershipId, points, totalScore, wins, losses, ties }) =>
    ({ membershipId, team: y.team.get(membershipId) ?? '', owner: y.owner.get(membershipId) ?? '', league: name, points, totalScore, wins, losses, ties })));
  const ahead = (o: typeof rows[number], r: typeof rows[number]) =>
    o.points > r.points || (o.points === r.points && o.totalScore > r.totalScore);
  return rows.map((r) => ({
    ...r,
    place: 1 + rows.filter((o) => ahead(o, r)).length,
    tied: rows.some((o) => o !== r && o.points === r.points && o.totalScore === r.totalScore),
  })).sort((a, b) => a.place - b.place || a.team.localeCompare(b.team) || a.league.localeCompare(b.league));
}

export interface PastTournament { stageId: string; name: string; starts_on: string; ends_on: string; waiting: boolean; rows: OverallStanding[] }

/**
 * Tournaments with a started game, except the one being played, newest first. Each ranks its teams by the points its
 * final games gave (byes included; a team that joined later is absent), ties by total score. `waiting`: a game still
 * live or pending.
 */
export function pastTournaments(y: Pick<LeagueTournament, 'result' | 'team' | 'owner' | 'stage' | 'stageDates'>): PastTournament[] {
  const byStage = new Map<string, GameOutcome[]>();
  for (const g of y.result.games) {
    if (g.status !== 'upcoming' && g.game.stageId !== y.result.next?.stageId) byStage.set(g.game.stageId, [...(byStage.get(g.game.stageId) ?? []), g]);
  }
  return [...byStage].map(([stageId, games]) => {
    const table = new Map<string, { membershipId: string; points: number; totalScore: number; wins: number; losses: number; ties: number }>();
    for (const g of games.filter((x) => x.status === 'final')) {
      for (const { home, away } of g.matchups) {
        for (const side of [home, away]) {
          if (!side) continue;
          const r = table.get(side.membershipId) ?? { membershipId: side.membershipId, points: 0, totalScore: 0, wins: 0, losses: 0, ties: 0 };
          r.points += side.delta ?? 0;
          r.totalScore += side.score ?? 0;
          if (side.result === 'W') r.wins++;
          else if (side.result === 'L') r.losses++;
          else if (side.result === 'T') r.ties++;
          table.set(side.membershipId, r);
        }
      }
    }
    // mergeStandings only reads the standings rows and the name maps.
    const rows = mergeStandings([{ name: '', y: { result: { standings: [...table.values()] } as unknown as TournamentResult, team: y.team, owner: y.owner } }]);
    return { stageId, name: y.stage.get(stageId) ?? '', ...y.stageDates.get(stageId)!, rows,
      waiting: games.some((g) => g.status === 'live' || g.status === 'pending') };
  }).sort((a, b) => b.starts_on.localeCompare(a.starts_on));
}

export interface LastForm { stageId: string; name: string; perGame: Map<string, number> }

/**
 * The buy list's form line: the latest tournament other than `excludeStageId` with a final game, and each athlete's
 * base points a game there (a final game without their line counts 0). Athletes with no line get no entry. Live,
 * pending and void games never count. Null before any such tournament.
 */
export function lastTournamentForm(y: LeagueTournament, excludeStageId: string): LastForm | null {
  const finals = new Map<string, GameOutcome[]>();
  for (const g of y.result.games) {
    if (g.status === 'final' && g.game.stageId !== excludeStageId) finals.set(g.game.stageId, [...(finals.get(g.game.stageId) ?? []), g]);
  }
  const date = (id: string) => y.stageDates.get(id)?.starts_on ?? '';
  const stageId = [...finals.keys()].sort((a, b) => date(b).localeCompare(date(a)) || b.localeCompare(a))[0];
  if (!stageId) return null;
  const games = finals.get(stageId)!;
  const sessions = new Set(games.map((g) => g.game.sessionId));
  const totals = new Map<string, number>();
  for (const l of y.input.statLines) {
    if (sessions.has(l.sessionId)) totals.set(l.athleteId, (totals.get(l.athleteId) ?? 0) + rawScore(l.stats, y.settings.stat_weights));
  }
  return { stageId, name: y.stage.get(stageId) ?? '', perGame: new Map([...totals].map(([a, t]) => [a, t / games.length])) };
}

export const countLeagues = async (seasonId: string) => (await leaguesOf(seasonId)).length;

/** The all-leagues leaderboard of a season. `own` is a league already loaded on the page: not fetched again. */
export async function loadSeasonStandings(seasonId: string, own?: { leagueId: string; y: LeagueTournament }): Promise<OverallStanding[]> {
  const leagues = await leaguesOf(seasonId);
  const years = await Promise.all(leagues.map(async (l) =>
    ({ name: l.name, y: l.id === own?.leagueId ? own.y : await loadLeagueTournament(seasonId, l.id) })));
  return mergeStandings(years);
}

/**
 * Whether a team needs you now: fewer picks for its next game than it owes (picks_per_game, or its whole roster if
 * shorter: C9), or open share buying without a buy from it. Dots the team switch.
 */
export function needsYou(
  y: Pick<LeagueTournament, 'result' | 'settings'>, membershipId: string,
  auction: { stage: Pick<AuctionStage, 'bid_close_at' | 'auction_run_at'>; bids: number } | null, now = Date.now(),
): boolean {
  const side = y.result.next?.sides.find((s) => s.membershipId === membershipId);
  if (side && side.picked.length < Math.min(y.settings.picks_per_game, side.players.length)) return true;
  return auction !== null && auctionPhase(auction.stage, now) === 'open' && auction.bids === 0;
}

export async function loadNeedsYou(membershipId: string, leagueId: string, seasonId: string): Promise<boolean> {
  const [y, st] = await Promise.all([
    loadLeagueTournament(seasonId, leagueId),
    supabase!.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId),
  ]);
  if (st.error) throw st.error;
  const stage = pickAuctionStage((st.data ?? []) as AuctionStage[]);
  if (!stage) return needsYou(y, membershipId, null);
  const bids = await supabase!.from('bids').select('athlete_id', { count: 'exact', head: true })
    .eq('stage_id', stage.id).eq('membership_id', membershipId);
  if (bids.error) throw bids.error;
  return needsYou(y, membershipId, { stage, bids: bids.count ?? 0 });
}
