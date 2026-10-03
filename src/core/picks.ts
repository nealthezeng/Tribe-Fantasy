import type { SeasonSettings } from './settings';

/**
 * `history`: each athlete's game scores in chronological order, one entry per settled game (0 when they had no line).
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

/**
 * Tournament mode §2: the most rested candidate (highest tiredness multiplier), then `defaultPick`'s order.
 * `tiredness` must cover every candidate.
 */
export function autoPick(
  candidates: string[],
  tiredness: Record<string, number>,
  history: Record<string, number[]>,
  s: SeasonSettings,
): string | null {
  const rest = (id: string) => {
    const m = tiredness[id];
    if (m === undefined) throw new Error(`No tiredness for ${id}`);
    return m;
  };
  const top = Math.max(...candidates.map(rest));
  return defaultPick(candidates.filter((c) => rest(c) === top), history, s);
}
