import { describe, expect, it } from 'vitest';
import { allocate, fillLeftovers, type Bid, type ManagerBudget } from './allocation';
import { hashSeed, mulberry32, seededShuffle } from './rng';

const t = (s: number) => new Date(Date.UTC(2027, 0, 25, 0, 0, s)).toISOString();
const bid = (id: string, managerId: string, athleteId: string, amount: number, sec = 0): Bid => ({
  id, managerId, athleteId, amount, placedAt: t(sec),
});
const mgr = (managerId: string, budget = 100, openSlots = 2): ManagerBudget => ({ managerId, budget, openSlots });

describe('allocate', () => {
  it('gives each athlete to the highest bidder', () => {
    const r = allocate([bid('b1', 'm1', 'a1', 10), bid('b2', 'm2', 'a1', 20)], [mgr('m1'), mgr('m2')], ['a1']);
    expect(r.awards).toEqual([{ managerId: 'm2', athleteId: 'a1', amount: 20, bidId: 'b2' }]);
    expect(r.remaining.find((m) => m.managerId === 'm2')).toEqual({ managerId: 'm2', budget: 80, openSlots: 1 });
  });

  it('breaks equal bids by earliest placedAt, then bid id', () => {
    const early = allocate([bid('b1', 'm1', 'a1', 10, 5), bid('b2', 'm2', 'a1', 10, 1)], [mgr('m1'), mgr('m2')], ['a1']);
    expect(early.awards[0].managerId).toBe('m2');
    const same = allocate([bid('b9', 'm1', 'a1', 10), bid('b3', 'm2', 'a1', 10)], [mgr('m1'), mgr('m2')], ['a1']);
    expect(same.awards[0].bidId).toBe('b3');
  });

  it('falls to the next bidder when the winner is out of budget or roster room', () => {
    const r = allocate(
      [bid('b1', 'm1', 'a1', 60), bid('b2', 'm1', 'a2', 50), bid('b3', 'm2', 'a2', 5)],
      [mgr('m1', 100), mgr('m2')],
      ['a1', 'a2'],
    );
    expect(r.awards.map((a) => [a.athleteId, a.managerId])).toEqual([['a1', 'm1'], ['a2', 'm2']]);
    const full = allocate(
      [bid('b1', 'm1', 'a1', 9), bid('b2', 'm1', 'a2', 8), bid('b3', 'm2', 'a2', 1)],
      [mgr('m1', 100, 1), mgr('m2')],
      ['a1', 'a2'],
    );
    expect(full.awards.map((a) => [a.athleteId, a.managerId])).toEqual([['a1', 'm1'], ['a2', 'm2']]);
  });

  it('ignores bids on unavailable athletes and from unknown managers, and reports unclaimed', () => {
    const r = allocate([bid('b1', 'm1', 'gone', 50), bid('b2', 'ghost', 'a1', 50)], [mgr('m1')], ['a1', 'a2']);
    expect(r.awards).toEqual([]);
    expect(r.unclaimed).toEqual(['a1', 'a2']);
  });

  it('holds invariants and is order-independent across random drafts', () => {
    for (let trial = 0; trial < 500; trial++) {
      const rand = mulberry32(hashSeed(`trial-${trial}`));
      const nM = 2 + Math.floor(rand() * 6);
      const nA = 5 + Math.floor(rand() * 25);
      const managers = Array.from({ length: nM }, (_, i) => mgr(`m${i}`, Math.floor(rand() * 200), 1 + Math.floor(rand() * 5)));
      const athletes = Array.from({ length: nA }, (_, i) => `a${i}`);
      const bids: Bid[] = [];
      for (const m of managers) for (const a of athletes) {
        if (rand() < 0.4) bids.push(bid(`${m.managerId}-${a}`, m.managerId, a, 1 + Math.floor(rand() * 60), Math.floor(rand() * 50)));
      }
      const r = allocate(bids, managers, athletes);

      const owners = new Set<string>();
      for (const aw of r.awards) {
        expect(owners.has(aw.athleteId)).toBe(false);
        owners.add(aw.athleteId);
        const b = bids.find((x) => x.id === aw.bidId)!;
        expect([b.managerId, b.athleteId, b.amount]).toEqual([aw.managerId, aw.athleteId, aw.amount]);
      }
      for (const m of managers) {
        const mine = r.awards.filter((a) => a.managerId === m.managerId);
        const spent = mine.reduce((sum, a) => sum + a.amount, 0);
        expect(mine.length).toBeLessThanOrEqual(m.openSlots);
        expect(spent).toBeLessThanOrEqual(m.budget);
        expect(r.remaining.find((x) => x.managerId === m.managerId)).toEqual({
          managerId: m.managerId, budget: m.budget - spent, openSlots: m.openSlots - mine.length,
        });
      }
      expect(allocate(seededShuffle(bids, `s${trial}`), managers, athletes)).toEqual(r);
    }
  });
});

describe('fillLeftovers', () => {
  it('deals unclaimed athletes round-robin into open slots, deterministically, at 0 credits', () => {
    const managers = [mgr('m1', 0, 2), mgr('m2', 0, 1), mgr('m3', 0, 0)];
    const awards = fillLeftovers(managers, ['a1', 'a2', 'a3', 'a4'], 'seed');
    expect(awards).toHaveLength(3);
    expect(awards.filter((a) => a.managerId === 'm1')).toHaveLength(2);
    expect(awards.filter((a) => a.managerId === 'm3')).toHaveLength(0);
    expect(awards.every((a) => a.amount === 0 && a.bidId === null)).toBe(true);
    expect(new Set(awards.map((a) => a.athleteId)).size).toBe(3);
    expect(fillLeftovers([...managers].reverse(), ['a4', 'a3', 'a2', 'a1'], 'seed')).toEqual(awards);
  });
});
