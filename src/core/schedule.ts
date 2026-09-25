export type Pairing = [string, string | null];

/** Circle method. Deterministic: managers are sorted first. */
export function roundRobin(managerIds: string[], weeks: number): Pairing[][] {
  const ids = [...managerIds].sort();
  if (ids.length < 2) {
    return Array.from({ length: weeks }, () => ids.map((id): Pairing => [id, null]));
  }
  const slots: (string | null)[] = ids.length % 2 === 1 ? [...ids, null] : [...ids];
  const n = slots.length;
  const rounds: Pairing[][] = [];
  let rest = slots.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const circle = [slots[0], ...rest];
    const round: Pairing[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = circle[i];
      const b = circle[n - 1 - i];
      round.push(a === null ? [b as string, null] : [a, b]);
    }
    rounds.push(round);
    rest = [rest[rest.length - 1], ...rest.slice(0, -1)];
  }
  return Array.from({ length: weeks }, (_, w) => rounds[w % rounds.length].map((p): Pairing => [p[0], p[1]]));
}
