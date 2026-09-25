import type { SeasonSettings } from './settings';

/** Spec §5.2. */
export function tenureMultiplier(week: number, acquiredWeek: number, s: SeasonSettings): number {
  if (s.decay_mode === 'none') return 1;
  const d = Math.max(0, week - acquiredWeek - s.decay_grace_weeks);
  const m = s.decay_mode === 'exponential' ? s.decay_rate ** d : 1 - (1 - s.decay_rate) * d;
  return Math.max(s.decay_floor, Math.min(1, m));
}

export interface OwnershipRecord {
  managerId: string;
  athleteId: string;
  acquiredWeek: number;
  releasedWeek: number | null;
}

/** Spec §5.4: returning to a recent owner restores that owner's old tenure. */
export function resolveAcquiredWeek(
  history: OwnershipRecord[],
  managerId: string,
  athleteId: string,
  currentWeek: number,
  s: SeasonSettings,
): number {
  let latest: OwnershipRecord | null = null;
  for (const r of history) {
    if (r.managerId !== managerId || r.athleteId !== athleteId || r.releasedWeek === null) continue;
    if (currentWeek - r.releasedWeek > s.decay_return_window) continue;
    if (latest === null || r.releasedWeek > (latest.releasedWeek as number)) latest = r;
  }
  return latest ? latest.acquiredWeek : currentWeek;
}
