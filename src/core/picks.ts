import type { SeasonSettings } from './settings';

export interface PickRecord {
  week: number;
  managerId: string;
  athleteId: string;
}

const coversRoster = (roster: string[], used: Set<string>) =>
  roster.length > 0 && roster.every((a) => used.has(a));

/**
 * Spec §5.7. Athletes on `roster` that the manager may not pick in week `beforeWeek`.
 * A cycle ends when every current rostered athlete has been used. Rosters only change between stages, so callers
 * pass only the current stage's picks.
 */
export function usedThisCycle(
  managerId: string,
  roster: string[],
  picks: PickRecord[],
  beforeWeek: number,
): Set<string> {
  const relevant = picks
    .filter((p) => p.week < beforeWeek && p.managerId === managerId)
    .sort((a, b) => a.week - b.week);
  let used = new Set<string>();
  let i = 0;
  while (i < relevant.length) {
    const week = relevant[i].week;
    for (; i < relevant.length && relevant[i].week === week; i++) used.add(relevant[i].athleteId);
    if (coversRoster(roster, used)) used = new Set();
  }
  return new Set(roster.filter((a) => used.has(a)));
}

export function availableAthletes(roster: string[], used: Set<string>): string[] {
  return roster.filter((a) => !used.has(a));
}

export function validatePick(
  athleteId: string,
  roster: string[],
  used: Set<string>,
): 'NOT_ON_ROSTER' | 'ATHLETE_ALREADY_USED' | null {
  if (!roster.includes(athleteId)) return 'NOT_ON_ROSTER';
  if (used.has(athleteId)) return 'ATHLETE_ALREADY_USED';
  return null;
}

/**
 * `history`: each athlete's week scores in chronological order, one entry per week.
 * The caller pushes `absent_score` for weeks an athlete had no stat lines.
 */
export function defaultPick(
  available: string[],
  history: Record<string, number[]>,
  s: SeasonSettings,
): string | null {
  if (s.default_pick === 'forfeit' || available.length === 0) return null;
  const avg = (id: string) => {
    const recent = (history[id] ?? []).slice(-3);
    return recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  };
  return [...available].sort((a, b) => avg(b) - avg(a) || (a < b ? -1 : a > b ? 1 : 0))[0];
}
