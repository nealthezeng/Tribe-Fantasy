import type { SeasonSettings } from './settings';

export interface StandingRow {
  managerId: string;
  points: number;
  totalScore: number;
}

export interface Side {
  managerId: string;
  score: number;
}

export const TIE_EPSILON = 0.01;

/** 1 = best. Managers equal on (points, totalScore) share their average rank. */
export function rankSnapshot(rows: StandingRow[]): Record<string, number> {
  const sorted = [...rows].sort((a, b) => b.points - a.points || b.totalScore - a.totalScore);
  const ranks: Record<string, number> = {};
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (
      j + 1 < sorted.length &&
      sorted[j + 1].points === sorted[i].points &&
      sorted[j + 1].totalScore === sorted[i].totalScore
    ) j++;
    const avg = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k++) ranks[sorted[k].managerId] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Spec §5.3. */
export function matchupDeltas(
  a: Side,
  b: Side,
  ranks: Record<string, number>,
  leagueSize: number,
  s: SeasonSettings,
): Record<string, number> {
  if (Math.abs(a.score - b.score) < TIE_EPSILON) {
    return { [a.managerId]: s.tie_points, [b.managerId]: s.tie_points };
  }
  const [winner, loser] = a.score > b.score ? [a, b] : [b, a];
  let factor = 1;
  if (s.points_mode === 'rank_weighted' && leagueSize >= 2) {
    const middle = (leagueSize + 1) / 2;
    const u = ((ranks[winner.managerId] ?? middle) - (ranks[loser.managerId] ?? middle)) / (leagueSize - 1);
    factor = Math.max(0, 1 + s.upset_k * u);
  }
  return {
    [winner.managerId]: s.win_points * factor,
    [loser.managerId]: 0 - s.loss_points * factor,
  };
}

export function applyDelta(points: number, delta: number, s: SeasonSettings): number {
  const next = points + delta;
  return s.standings_floor === null ? next : Math.max(s.standings_floor, next);
}
