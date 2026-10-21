/** What a team's matchup showed the last time this device looked (t319): the base for "+3 since you last looked". */
export interface Seen { mine: number | null; them: number | null; points: { mine: Record<string, number>; them: Record<string, number> } }

// ponytail: one small key per team per game, never cleaned up; sweep old `tribe.seen.*` keys if storage ever matters.
export const seenKey = (membershipId: string, gameId: string) => `tribe.seen.${membershipId}.${gameId}`;

const isNum = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
const isScore = (x: unknown) => x === null || isNum(x);
const isPoints = (x: unknown) => typeof x === 'object' && x !== null && Object.values(x).every(isNum);

export function readSeen(key: string): Seen | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v && isScore(v.mine) && isScore(v.them) && isPoints(v.points?.mine) && isPoints(v.points?.them) ? v : null;
  } catch { return null; }
}

export function writeSeen(key: string, v: Seen): void {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* remembered for this visit only */ }
}

const diffs = (prev: Record<string, number>, cur: Record<string, number>) =>
  Object.fromEntries(Object.entries(cur).flatMap(([a, n]) => (a in prev && Math.abs(n - prev[a]) >= 0.01 ? [[a, n - prev[a]]] : [])));

/** Per-side athlete → points gained (negative: lost) since `prev`; null when no score or starter moved by 0.01. */
export function changes(prev: Seen | null, cur: Seen): { mine: Record<string, number>; them: Record<string, number> } | null {
  if (!prev) return null;
  const out = { mine: diffs(prev.points.mine, cur.points.mine), them: diffs(prev.points.them, cur.points.them) };
  const moved = (a: number | null, b: number | null) => a !== b && (a === null || b === null || Math.abs(a - b) >= 0.01);
  return moved(prev.mine, cur.mine) || moved(prev.them, cur.them) || Object.keys(out.mine).length + Object.keys(out.them).length > 0 ? out : null;
}
