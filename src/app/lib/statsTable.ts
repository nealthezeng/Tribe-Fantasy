import { rawScore } from '../../core/scoring';
import { pickPlayingStage, type AuctionStage } from './auction';
import { gameLabel, todayLocal } from './stats';
import { supabase } from './supabase';
import { GAME_COLUMNS, fetchAll, rowsOf, type GameRow } from './tournament';

export interface StatRow { key: string; label: string; counts: Record<string, number>; points: number }
export interface LineRow { session_id: string; athlete_id: string; stats: Record<string, number> }

/** One row per athlete: counts summed across `lines`, points = base points under `weights`. */
export function totals(lines: Pick<LineRow, 'athlete_id' | 'stats'>[], names: Map<string, string>, weights: Record<string, number>): StatRow[] {
  const by = new Map<string, Record<string, number>>();
  for (const l of lines) {
    const counts = by.get(l.athlete_id) ?? {};
    for (const [k, n] of Object.entries(l.stats)) counts[k] = (counts[k] ?? 0) + n;
    by.set(l.athlete_id, counts);
  }
  return [...by].map(([key, counts]) => ({ key, label: names.get(key) ?? 'Unknown', counts, points: rawScore(counts, weights) }));
}

export type SortKey = 'label' | 'points' | string;

/** A new array sorted by `key` (a stat missing = 0); ties and `label` read A→Z, `desc` flips the key's order only. */
export function sortRows(rows: StatRow[], key: SortKey, desc: boolean): StatRow[] {
  const sign = desc ? -1 : 1;
  const value = (r: StatRow) => (key === 'points' ? r.points : r.counts[key] ?? 0);
  return [...rows].sort((a, b) => (key === 'label' ? sign * a.label.localeCompare(b.label)
    : sign * (value(a) - value(b)) || a.label.localeCompare(b.label)));
}

export type StatsStage = Pick<AuctionStage, 'id' | 'name' | 'starts_on' | 'ends_on' | 'auction_run_at'>;

/** The `?t=` tournament if it is listed, else the one being played (or the latest). */
export function pickStatsStage(stages: StatsStage[], wanted: string | null, today: string): StatsStage | null {
  return stages.find((s) => s.id === wanted) ?? pickPlayingStage(stages, today);
}

export interface StatsGame extends GameRow { label: string; verified_at: string | null }
export interface TournamentStats {
  stages: StatsStage[]; stage: StatsStage | null; games: StatsGame[]; lines: LineRow[]; names: Map<string, string>;
}

/** The season's run tournaments (newest first) and, for the picked one, its games and verified stat lines. */
export async function loadTournamentStats(seasonId: string, wanted: string | null, today = todayLocal()): Promise<TournamentStats> {
  const sb = supabase!;
  const stages = (await rowsOf<StatsStage>(sb.from('stages').select('id, name, starts_on, ends_on, auction_run_at')
    .eq('season_id', seasonId).not('auction_run_at', 'is', null))).sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  const stage = pickStatsStage(stages, wanted, today);
  if (!stage) return { stages, stage, games: [], lines: [], names: new Map() };
  const [games, athletes] = await Promise.all([
    rowsOf<GameRow>(sb.from('games').select(GAME_COLUMNS).eq('stage_id', stage.id).order('number')),
    rowsOf<{ id: string; name: string }>(sb.from('athletes').select('id, name').eq('season_id', seasonId)),
  ]);
  const sessionIds = games.flatMap((g) => (g.session_id ? [g.session_id] : []));
  const [sessions, lines] = await Promise.all([
    rowsOf<{ id: string; verified_at: string | null }>(sessionIds.length ? sb.from('sessions').select('id, verified_at').in('id', sessionIds) : null),
    sessionIds.length
      ? fetchAll<LineRow>((from, to) => sb.from('stat_lines').select('session_id, athlete_id, stats')
        .in('session_id', sessionIds).order('session_id').order('athlete_id').range(from, to))
      : [],
  ]);
  const verified = new Map(sessions.map((s) => [s.id, s.verified_at]));
  return {
    stages, stage, lines, names: new Map(athletes.map((a) => [a.id, a.name])),
    games: games.map((g) => ({ ...g, label: gameLabel(g.number, g.opponent), verified_at: (g.session_id && verified.get(g.session_id)) || null })),
  };
}
