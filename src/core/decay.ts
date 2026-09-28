import type { SeasonSettings } from './settings';

/**
 * Stages revision §4. `stagesStarted` = earlier stages in which this manager started this athlete.
 * linear steps down by (1 − decay_rate) per stage past the grace.
 */
export function stageMultiplier(stagesStarted: number, s: SeasonSettings): number {
  if (s.decay_mode === 'none') return 1;
  const d = Math.max(0, stagesStarted - s.decay_grace_stages);
  const m = s.decay_mode === 'exponential' ? s.decay_rate ** d : 1 - (1 - s.decay_rate) * d;
  return Math.max(s.decay_floor, Math.min(1, m));
}
