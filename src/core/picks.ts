import type { SeasonSettings } from './settings';

/**
 * `history`: each athlete's game scores in chronological order, one entry per settled game (0 when they had no line).
 * `share`: the manager's share of each athlete, weighting the average; missing = 1.
 */
export function defaultPick(
  available: string[],
  history: Record<string, number[]>,
  s: SeasonSettings,
  share: Record<string, number> = {},
): string | null {
  if (s.default_pick === 'forfeit' || available.length === 0) return null;
  const avg = (id: string) => {
    const recent = (history[id] ?? []).slice(-3);
    return recent.length ? (share[id] ?? 1) * recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  };
  return [...available].sort((a, b) => avg(b) - avg(a) || (a < b ? -1 : a > b ? 1 : 0))[0];
}

/**
 * Tournament mode §2 / M13 C4: the most rested candidate (highest tiredness multiplier), then `defaultPick`'s order
 * (share × recent average, then lowest id).
 * `tiredness` must cover every candidate.
 */
export function autoPick(
  candidates: string[],
  tiredness: Record<string, number>,
  history: Record<string, number[]>,
  s: SeasonSettings,
  share: Record<string, number> = {},
): string | null {
  const rest = (id: string) => {
    const m = tiredness[id];
    if (m === undefined) throw new Error(`No tiredness for ${id}`);
    return m;
  };
  const top = Math.max(...candidates.map(rest));
  return defaultPick(candidates.filter((c) => rest(c) === top), history, s, share);
}
