/** One matchup: `[home, away]`, away null = bye. */
export type Pairing = [string, string | null];

/** Key for how often two teams (or a team and the bye, `b` null) have met. Order-free. */
export const meetingKey = (a: string, b: string | null) =>
  b === null ? `${a}|` : a < b ? `${a}|${b}` : `${b}|${a}`;

/**
 * Tournament mode §2. `order`: teams best first (the caller sorts by points, total score, id). `meetings`: this
 * tournament's counts by `meetingKey`, byes included; `seasonMeetings`: the whole season's (this tournament included).
 * Picks the pairing with the fewest tournament rematches, then the fewest season rematches, then the smallest total
 * distance in the standings, then the first in standings order. Higher-placed team first; the bye is `[team, null]`.
 * Tries every pairing: fine for leagues of ≤ 12 (10 395 pairings), not for big ones.
 */
export function swissPairings(
  order: string[],
  meetings: Record<string, number>,
  seasonMeetings: Record<string, number> = {},
): Pairing[] {
  // Slot index = place. The bye sits last, so it goes to the lowest-placed team that hasn't had one.
  const slots: (string | null)[] = order.length % 2 === 1 ? [...order, null] : [...order];
  type Best = { rematches: number; seasonRematches: number; distance: number; pairs: [number, number][] };
  let best = null as Best | null;

  // Lexicographic (rematches, seasonRematches, distance); each only grows, so a partial >= best can't win.
  const search = (free: number[], pairs: [number, number][], rematches: number, seasonRematches: number, distance: number) => {
    if (best && (rematches > best.rematches || (rematches === best.rematches && (seasonRematches > best.seasonRematches ||
      (seasonRematches === best.seasonRematches && distance >= best.distance))))) return;
    if (free.length === 0) {
      best = { rematches, seasonRematches, distance, pairs: [...pairs] };
      return;
    }
    const [i, ...rest] = free;
    for (const j of rest) {
      const key = meetingKey(slots[i] as string, slots[j]);
      pairs.push([i, j]);
      search(rest.filter((k) => k !== j), pairs, rematches + (meetings[key] ?? 0), seasonRematches + (seasonMeetings[key] ?? 0),
        distance + j - i);
      pairs.pop();
    }
  };
  search(slots.map((_, i) => i), [], 0, 0, 0);

  return (best?.pairs ?? []).map(([i, j]): Pairing => [slots[i] as string, slots[j]]);
}
