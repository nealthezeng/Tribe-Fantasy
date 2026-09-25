/** One +1 tap, or (with `undoes`) the undo of an earlier tap by the same keeper. */
export interface Tap {
  id: string;
  athleteId: string;
  stat: string;
  keeperId: string;
  tappedAt: number; // epoch ms, already skew-corrected by the server
  undoes: string | null;
}

/** Taps from different keepers that were counted once. */
export interface MergedGroup {
  athleteId: string;
  stat: string;
  tapIds: string[];
}

export interface MergeResult {
  counts: Record<string, Record<string, number>>; // athleteId -> stat -> count (only counts > 0)
  merged: MergedGroup[];
}

const byTime = (a: Tap, b: Tap) => a.tappedAt - b.tappedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * M3 spec §4. Undos drop out with the tap they name. The remaining taps per athlete + stat are grouped,
 * closest pair first; two groups join only if they share no keeper and the joined group spans
 * <= windowSeconds. Each group counts once. windowSeconds <= 0 disables merging.
 */
export function mergeTaps(taps: Tap[], windowSeconds: number): MergeResult {
  const undone = new Set(taps.filter((t) => t.undoes !== null).map((t) => t.undoes));
  const groups = new Map<string, Tap[]>();
  for (const t of [...taps].sort(byTime)) {
    if (t.undoes !== null || undone.has(t.id)) continue;
    const key = `${t.athleteId}\u0000${t.stat}`;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }

  const windowMs = windowSeconds * 1000;
  const counts: MergeResult['counts'] = {};
  const merged: MergedGroup[] = [];
  for (const live of groups.values()) {
    // ponytail: greedy closest-first clustering, O(n²) per athlete + stat; fine for a practice's worth of taps.
    const clusters = live.map((_, i) => [i]);
    const owner = live.map((_, i) => i);
    const edges: { i: number; j: number; dt: number }[] = [];
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const dt = live[j].tappedAt - live[i].tappedAt;
        if (windowMs > 0 && dt <= windowMs && live[i].keeperId !== live[j].keeperId) edges.push({ i, j, dt });
      }
    }
    edges.sort((a, b) => a.dt - b.dt || a.i - b.i || a.j - b.j);
    for (const { i, j } of edges) {
      const a = owner[i];
      const b = owner[j];
      if (a === b) continue;
      const joined = [...clusters[a], ...clusters[b]];
      const keepers = new Set(joined.map((k) => live[k].keeperId));
      const times = joined.map((k) => live[k].tappedAt);
      if (keepers.size !== joined.length || Math.max(...times) - Math.min(...times) > windowMs) continue;
      clusters[a] = joined;
      clusters[b] = [];
      for (const k of joined) owner[k] = a;
    }

    const kept = clusters.filter((c) => c.length > 0);
    const { athleteId, stat } = live[0];
    (counts[athleteId] ??= {})[stat] = kept.length;
    for (const c of kept) {
      if (c.length > 1) merged.push({ athleteId, stat, tapIds: c.map((k) => live[k].id).sort() });
    }
  }
  return { counts, merged };
}
