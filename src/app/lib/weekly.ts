import { parseSettings, type SeasonSettings } from '../../core/settings';
import { scoreYear, type YearInput, type YearResult, type YearSession, type YearStatLine } from '../../core/year';
import { supabase } from './supabase';

export interface WeekRow {
  id: string; stage_id: string; starts_on: string; ends_on: string; starts_at: string; ends_at: string; pick_lock_at: string;
}
export const WEEK_COLUMNS = 'id, stage_id, starts_on, ends_on, starts_at, ends_at, pick_lock_at';
interface SessionRow { id: string; kind: 'practice' | 'tournament'; held_on: string; counts: boolean; verified_at: string | null }
interface LineRow { session_id: string; athlete_id: string; stats: Record<string, number>; points_played: number }
interface InjuryRow { athlete_id: string; confirmed_at: string | null; cleared_at: string | null }

/** Rows as PostgREST returns them, for one league of one season. */
export interface LeagueRows {
  settings: unknown;
  stages: { id: string; name: string }[];
  weeks: WeekRow[];
  members: { id: string; team_name: string; created_at: string }[];
  slots: { stage_id: string; membership_id: string; athlete_id: string }[];
  picks: { week_id: string; membership_id: string; athlete_id: string }[];
  sessions: SessionRow[];
  lines: LineRow[];
  injuries: InjuryRow[];
  athletes: { id: string; name: string }[];
}

export interface LeagueYear {
  settings: SeasonSettings;
  result: YearResult;
  team: Map<string, string>;
  athlete: Map<string, string>;
  stage: Map<string, string>;
  /** Athletes with a confirmed injury that hasn't cleared. */
  injured: Set<string>;
  sessions: YearSession[];
  statLines: YearStatLine[];
}

export function toYearInput(rows: LeagueRows, now: number): YearInput {
  const athletes = new Set(rows.athletes.map((a) => a.id));
  return {
    settings: parseSettings(rows.settings),
    now,
    weeks: rows.weeks.map((w) => ({
      id: w.id, stageId: w.stage_id, startsOn: w.starts_on, endsOn: w.ends_on,
      startsAt: w.starts_at, endsAt: w.ends_at, pickLockAt: w.pick_lock_at,
    })),
    members: rows.members.map((m) => ({ id: m.id, createdAt: m.created_at })),
    slots: rows.slots.map((x) => ({ stageId: x.stage_id, membershipId: x.membership_id, athleteId: x.athlete_id })),
    picks: rows.picks.map((p) => ({ weekId: p.week_id, membershipId: p.membership_id, athleteId: p.athlete_id })),
    sessions: rows.sessions.map((x) => ({ id: x.id, kind: x.kind, heldOn: x.held_on, counts: x.counts, verifiedAt: x.verified_at })),
    statLines: rows.lines.map((l) => ({ sessionId: l.session_id, athleteId: l.athlete_id, stats: l.stats, pointsPlayed: l.points_played })),
    // Injuries have no season column: keep this season's athletes, confirmed reports only.
    injuries: rows.injuries.filter((i) => i.confirmed_at !== null && athletes.has(i.athlete_id))
      .map((i) => ({ athleteId: i.athlete_id, confirmedAt: i.confirmed_at!, clearedAt: i.cleared_at })),
  };
}

export function buildLeagueYear(rows: LeagueRows, now = Date.now()): LeagueYear {
  const input = toYearInput(rows, now);
  return {
    settings: input.settings,
    result: scoreYear(input),
    team: new Map(rows.members.map((m) => [m.id, m.team_name])),
    athlete: new Map(rows.athletes.map((a) => [a.id, a.name])),
    stage: new Map(rows.stages.map((x) => [x.id, x.name])),
    injured: new Set(input.injuries.filter((i) => i.clearedAt === null).map((i) => i.athleteId)),
    sessions: input.sessions,
    statLines: input.statLines,
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

/** Every row the league's year needs; RLS hides other teams' picks until each week locks. */
export async function loadLeagueRows(seasonId: string, leagueId: string): Promise<LeagueRows> {
  const sb = supabase!;
  const [season, stages, members, slots, picks, sessions, injuries, athletes] = await Promise.all([
    sb.from('seasons').select('settings').eq('id', seasonId).single(),
    sb.from('stages').select('id, name').eq('season_id', seasonId),
    sb.from('memberships').select('id, team_name, created_at').eq('league_id', leagueId),
    sb.from('roster_slots').select('stage_id, membership_id, athlete_id').eq('league_id', leagueId),
    sb.from('picks').select('week_id, membership_id, athlete_id').eq('league_id', leagueId),
    sb.from('sessions').select('id, kind, held_on, counts, verified_at').eq('season_id', seasonId).eq('counts', true),
    sb.from('injuries').select('athlete_id, confirmed_at, cleared_at').not('confirmed_at', 'is', null),
    sb.from('athletes').select('id, name').eq('season_id', seasonId),
  ]);
  for (const r of [season, stages, members, slots, picks, sessions, injuries, athletes]) if (r.error) throw r.error;
  const stageIds = (stages.data ?? []).map((x) => x.id as string);
  const sessionIds = (sessions.data ?? []).map((x) => x.id as string);
  const [weeks, lines] = await Promise.all([
    stageIds.length ? sb.from('weeks').select(WEEK_COLUMNS).in('stage_id', stageIds) : { data: [], error: null },
    sessionIds.length
      ? fetchAll<LineRow>((from, to) => sb.from('stat_lines').select('session_id, athlete_id, stats, points_played')
        .in('session_id', sessionIds).order('session_id').order('athlete_id').range(from, to))
      : [],
  ]);
  if ('error' in weeks && weeks.error) throw weeks.error;
  return {
    settings: season.data!.settings,
    stages: (stages.data ?? []) as LeagueRows['stages'],
    weeks: ((weeks as { data: unknown }).data ?? []) as WeekRow[],
    members: (members.data ?? []) as LeagueRows['members'],
    slots: (slots.data ?? []) as LeagueRows['slots'],
    picks: (picks.data ?? []) as LeagueRows['picks'],
    sessions: (sessions.data ?? []) as SessionRow[],
    lines: lines as LineRow[],
    injuries: (injuries.data ?? []) as InjuryRow[],
    athletes: (athletes.data ?? []) as LeagueRows['athletes'],
  };
}

export const loadLeagueYear = async (seasonId: string, leagueId: string) =>
  buildLeagueYear(await loadLeagueRows(seasonId, leagueId));

/**
 * The allowance input for every league of the season: {membership: rank}, plus how many weeks that start before
 * `before` (the stage being granted) aren't settled yet in any league.
 */
export async function seasonRanks(seasonId: string, before: string): Promise<{ ranks: Record<string, number>; unsettled: number }> {
  const leagues = await supabase!.from('leagues').select('id').eq('season_id', seasonId);
  if (leagues.error) throw leagues.error;
  const years = await Promise.all((leagues.data ?? []).map((l) => loadLeagueYear(seasonId, l.id as string)));
  const ranks: Record<string, number> = {};
  const unsettled = new Set<string>();
  for (const y of years) {
    for (const row of y.result.standings) ranks[row.membershipId] = row.rank;
    for (const w of y.result.weeks) {
      if (w.week.startsOn < before && w.status !== 'final' && w.status !== 'skipped') unsettled.add(w.week.id);
    }
  }
  return { ranks, unsettled: unsettled.size };
}
