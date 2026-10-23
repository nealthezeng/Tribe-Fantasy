import { AUCTION_STAGE_COLUMNS, auctionPhase, type AuctionStage } from './auction';
import { todayLocal } from './stats';
import { supabase } from './supabase';
import { GAME_COLUMNS, rowsOf, type GameRow } from './tournament';

// What Admin warns about: a game holding back every later result (P9 ruling 18), teams with no credits (ruling 12).

export interface StuckGame { stage: string; number: number; sessionId: string; live: boolean }
export interface LateTeam { id: string; team: string; league: string }

/**
 * Games whose tournament's last day has passed that started but aren't verified: the core holds every later result
 * back until they are. `live` when not finished either. A void game (its session deleted) holds nothing back.
 */
export function stuckGames(
  stages: { id: string; name: string; ends_on: string }[], games: GameRow[], sessions: { id: string; verified_at: string | null }[], today: string,
): StuckGame[] {
  const over = new Map(stages.filter((s) => s.ends_on < today).map((s) => [s.id, s.name]));
  const open = new Set(sessions.filter((s) => s.verified_at === null).map((s) => s.id));
  return games.filter((g) => g.started_at !== null && over.has(g.stage_id) && open.has(g.session_id ?? ''))
    .map((g) => ({ stage: over.get(g.stage_id)!, number: g.number, sessionId: g.session_id!, live: g.finished_at === null }));
}

/** Teams with no `stageId` allowance: they joined after its credits went out. None until any team has that allowance. */
export function lateJoiners(
  memberships: { id: string; team_name: string; league: string }[], allowanceRows: { membership_id: string; stage_id: string }[], stageId: string,
): LateTeam[] {
  const got = new Set(allowanceRows.filter((r) => r.stage_id === stageId).map((r) => r.membership_id));
  return got.size === 0 ? [] : memberships.filter((m) => !got.has(m.id)).map((m) => ({ id: m.id, team: m.team_name, league: m.league }));
}

/** The season's stuck games, for the warning on top of Admin. */
export async function loadAdminWarnings(seasonId: string, today = todayLocal()): Promise<StuckGame[]> {
  const sb = supabase!;
  const stages = await rowsOf<{ id: string; name: string; ends_on: string }>(sb.from('stages').select('id, name, ends_on').eq('season_id', seasonId));
  const games = await rowsOf<GameRow>(stages.length ? sb.from('games').select(GAME_COLUMNS).in('stage_id', stages.map((s) => s.id)).order('number') : null);
  const ids = games.flatMap((g) => (g.session_id ? [g.session_id] : []));
  const sessions = await rowsOf<{ id: string; verified_at: string | null }>(ids.length ? sb.from('sessions').select('id, verified_at').in('id', ids) : null);
  return stuckGames(stages, games, sessions, today);
}

/**
 * The newest tournament whose shares aren't settled and its late joiners (removed teams left out, they need no
 * credits); null when every tournament is settled. Tournaments' due step and the Wallets pill read it.
 */
export async function loadLateJoiners(seasonId: string): Promise<{ stage: { id: string; name: string }; teams: LateTeam[] } | null> {
  const sb = supabase!;
  const stages = await rowsOf<AuctionStage>(sb.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId));
  const stage = stages.filter((s) => auctionPhase(s) !== 'run').sort((a, b) => b.starts_on.localeCompare(a.starts_on))[0];
  if (!stage) return null;
  const [leagues, allowance] = await Promise.all([
    rowsOf<{ name: string; memberships: { id: string; team_name: string; removed_at: string | null }[] }>(
      sb.from('leagues').select('name, memberships(id, team_name, removed_at)').eq('season_id', seasonId).order('name')),
    rowsOf<{ membership_id: string; stage_id: string }>(
      sb.from('credit_ledger').select('membership_id, stage_id').eq('stage_id', stage.id).eq('kind', 'allowance')),
  ]);
  const members = leagues.flatMap((l) => l.memberships.filter((m) => m.removed_at === null).map((m) => ({ ...m, league: l.name })));
  return { stage: { id: stage.id, name: stage.name }, teams: lateJoiners(members, allowance, stage.id) };
}
