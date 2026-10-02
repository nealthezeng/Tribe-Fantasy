import type { Pairing } from './schedule';

/** Key for how often two teams (or a team and the bye, `b` null) have met. Order-free. */
export const meetingKey = (a: string, b: string | null) =>
  b === null ? `${a}|` : a < b ? `${a}|${b}` : `${b}|${a}`;

/**
 * Tournament mode §2. `order`: teams best first (the caller sorts by points, total score, id). `meetings`: counts by
 * `meetingKey`, byes included. Picks the pairing with the fewest rematches, then the smallest total distance in the
 * standings, then the first in standings order. Higher-placed team first; the bye is `[team, null]`.
 * Tries every pairing: fine for leagues of ≤ 8 (105 pairings), not for big ones.
 */
export function swissPairings(order: string[], meetings: Record<string, number>): Pairing[] {
  // Slot index = place. The bye sits last, so it goes to the lowest-placed team that hasn't had one.
  const slots: (string | null)[] = order.length % 2 === 1 ? [...order, null] : [...order];
  type Best = { rematches: number; distance: number; pairs: [number, number][] };
  let best = null as Best | null;

  const search = (free: number[], pairs: [number, number][], rematches: number, distance: number) => {
    if (best && (rematches > best.rematches || (rematches === best.rematches && distance >= best.distance))) return;
    if (free.length === 0) {
      best = { rematches, distance, pairs: [...pairs] };
      return;
    }
    const [i, ...rest] = free;
    for (const j of rest) {
      const met = meetings[meetingKey(slots[i] as string, slots[j])] ?? 0;
      pairs.push([i, j]);
      search(rest.filter((k) => k !== j), pairs, rematches + met, distance + j - i);
      pairs.pop();
    }
  };
  search(slots.map((_, i) => i), [], 0, 0);

  return (best?.pairs ?? []).map(([i, j]): Pairing => [slots[i] as string, slots[j]]);
}
