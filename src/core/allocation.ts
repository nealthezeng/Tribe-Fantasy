import { seededShuffle } from './rng';

export interface Bid {
  id: string;
  managerId: string;
  athleteId: string;
  amount: number;
  placedAt: string;
}

export interface ManagerBudget {
  managerId: string;
  budget: number;
  openSlots: number;
}

export interface Award {
  managerId: string;
  athleteId: string;
  amount: number;
  bidId: string | null;
}

export interface AllocationResult {
  awards: Award[];
  remaining: ManagerBudget[];
  unclaimed: string[];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function compareBids(a: Bid, b: Bid): number {
  return b.amount - a.amount || Date.parse(a.placedAt) - Date.parse(b.placedAt) || byString(a.id, b.id);
}

/** Spec §5.5: highest bid first; skip if taken, roster full or unaffordable. */
export function allocate(bids: Bid[], managers: ManagerBudget[], athleteIds: string[]): AllocationResult {
  const state = new Map(managers.map((m) => [m.managerId, { ...m }]));
  const open = new Set(athleteIds);
  const awards: Award[] = [];
  for (const b of [...bids].sort(compareBids)) {
    const m = state.get(b.managerId);
    if (!m || !open.has(b.athleteId) || m.openSlots <= 0 || m.budget < b.amount) continue;
    open.delete(b.athleteId);
    m.budget -= b.amount;
    m.openSlots -= 1;
    awards.push({ managerId: m.managerId, athleteId: b.athleteId, amount: b.amount, bidId: b.id });
  }
  return {
    awards,
    remaining: managers.map((m) => ({ ...state.get(m.managerId)! })),
    unclaimed: athleteIds.filter((a) => open.has(a)),
  };
}

/** Spec §5.5 final fill: seeded shuffle, dealt one per manager per pass, 0 credits. */
export function fillLeftovers(managers: ManagerBudget[], unclaimed: string[], seed: string): Award[] {
  const pool = seededShuffle([...unclaimed].sort(byString), `${seed}:athletes`);
  const order = seededShuffle(
    [...managers].sort((a, b) => byString(a.managerId, b.managerId)).map((m) => ({ ...m })),
    `${seed}:managers`,
  );
  const awards: Award[] = [];
  let progressed = true;
  while (pool.length > 0 && progressed) {
    progressed = false;
    for (const m of order) {
      if (pool.length === 0) break;
      if (m.openSlots <= 0) continue;
      awards.push({ managerId: m.managerId, athleteId: pool.shift()!, amount: 0, bidId: null });
      m.openSlots -= 1;
      progressed = true;
    }
  }
  return awards;
}
