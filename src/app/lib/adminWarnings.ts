import { todayLocal } from './stats';
import { supabase } from './supabase';
import { GAME_COLUMNS, rowsOf, type GameRow } from './tournament';

// What Admin warns about: a game holding back every later result (P9 ruling 18).

export interface StuckGame { stage: string; number: number; sessionId: string; live: boolean }

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

/** The season's stuck games, for the warning on top of Admin. */
export async function loadAdminWarnings(seasonId: string, today = todayLocal()): Promise<StuckGame[]> {
  const sb = supabase!;
  const stages = await rowsOf<{ id: string; name: string; ends_on: string }>(sb.from('stages').select('id, name, ends_on').eq('season_id', seasonId));
  const games = await rowsOf<GameRow>(stages.length ? sb.from('games').select(GAME_COLUMNS).in('stage_id', stages.map((s) => s.id)).order('number') : null);
  const ids = games.flatMap((g) => (g.session_id ? [g.session_id] : []));
  const sessions = await rowsOf<{ id: string; verified_at: string | null }>(ids.length ? sb.from('sessions').select('id, verified_at').in('id', ids) : null);
  return stuckGames(stages, games, sessions, today);
}
