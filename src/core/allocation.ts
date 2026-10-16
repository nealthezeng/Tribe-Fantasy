export interface Bid {
  id: string;
  managerId: string;
  athleteId: string;
  amount: number;
  placedAt: string;
}

export interface Holding {
  managerId: string;
  athleteId: string;
  amount: number;
  share: number;
  bidId: string;
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function compareBids(a: Bid, b: Bid): number {
  return b.amount - a.amount || Date.parse(a.placedAt) - Date.parse(b.placedAt) || byString(a.id, b.id);
}

/**
 * Spec §4 run_auction: per manager, largest buy first; keep it if > 0, the roster has room and it fits the
 * remaining budget (else drop and try smaller). Then pool = max(minShares, kept total) and share = amount / pool.
 * Callers pass one league's bids. Sorted by athleteId, then managerId.
 */
export function settleShares(bids: Bid[], budgets: Record<string, number>, minShares: number, rosterSize: number): Holding[] {
  const kept: Bid[] = [];
  const left = new Map<string, { budget: number; count: number }>();
  for (const b of [...bids].sort(compareBids)) {
    const m = left.get(b.managerId) ?? { budget: budgets[b.managerId] ?? 0, count: 0 };
    left.set(b.managerId, m);
    if (b.amount <= 0 || m.count >= rosterSize || b.amount > m.budget) continue;
    m.budget -= b.amount;
    m.count += 1;
    kept.push(b);
  }
  const pool = new Map<string, number>();
  for (const b of kept) pool.set(b.athleteId, (pool.get(b.athleteId) ?? 0) + b.amount);
  return kept
    .map((b) => ({
      managerId: b.managerId,
      athleteId: b.athleteId,
      amount: b.amount,
      share: b.amount / Math.max(minShares, pool.get(b.athleteId)!),
      bidId: b.id,
    }))
    .sort((a, b) => byString(a.athleteId, b.athleteId) || byString(a.managerId, b.managerId));
}
