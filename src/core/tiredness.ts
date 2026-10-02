import type { SeasonSettings } from './settings';

/**
 * Tournament mode §2. `gap` = this game's number minus the last game this stage in which the same manager started
 * the athlete; null if they haven't started them this stage.
 */
export function tirednessMultiplier(gap: number | null, s: SeasonSettings): number {
  if (gap === null) return 1;
  if (!Number.isInteger(gap) || gap < 1) throw new Error(`Invalid tiredness gap ${gap}`);
  return s.tiredness_multipliers[gap - 1] ?? 1;
}
