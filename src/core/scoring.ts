import type { SeasonSettings, SessionType } from './settings';

export interface StatLine {
  athleteId: string;
  sessionType: SessionType;
  pointsPlayed: number;
  stats: Record<string, number>;
}

export function rawScore(stats: Record<string, number>, weights: Record<string, number>): number {
  let total = 0;
  for (const [stat, count] of Object.entries(stats)) total += (weights[stat] ?? 0) * count;
  return total;
}

/** Spec §5.1. `lines` must already be one athlete's locked, counted lines for the week. */
export function athleteWeekScore(lines: StatLine[], s: SeasonSettings): number {
  if (lines.length === 0) return s.absent_score;
  let weighted = 0;
  let points = 0;
  for (const l of lines) {
    weighted += (s.session_multipliers[l.sessionType] ?? 1) * rawScore(l.stats, s.stat_weights);
    points += l.pointsPlayed;
  }
  if (s.normalize_mode === 'none') return weighted;
  return (weighted / Math.max(points, s.min_points_denominator)) * s.normalize_per_points;
}
