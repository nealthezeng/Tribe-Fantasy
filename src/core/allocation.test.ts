import { describe, expect, it } from 'vitest';
import { settleShares, type Bid } from './allocation';

const t = (s: number) => new Date(Date.UTC(2027, 0, 25, 0, 0, s)).toISOString();
const bid = (id: string, managerId: string, athleteId: string, amount: number, sec = 0): Bid => ({
  id, managerId, athleteId, amount, placedAt: t(sec),
});
const share = (h: ReturnType<typeof settleShares>, m: string, a: string) =>
  h.find((x) => x.managerId === m && x.athleteId === a)?.share;

describe('settleShares', () => {
  it('splits a pool by credits (spec example)', () => {
    const h = settleShares(
      [bid('b1', 'm1', 'a1', 100), bid('b2', 'm2', 'a1', 50), bid('b3', 'm2', 'a2', 1)],
      { m1: 200, m2: 200 }, 20, 6,
    );
    expect(h.map((x) => [x.athleteId, x.managerId])).toEqual([['a1', 'm1'], ['a1', 'm2'], ['a2', 'm2']]);
    expect(share(h, 'm1', 'a1')).toBeCloseTo(2 / 3);
    expect(share(h, 'm2', 'a1')).toBeCloseTo(1 / 3);
    expect(share(h, 'm2', 'a2')).toBeCloseTo(0.05);
  });

  it('drops an unaffordable buy and still keeps a smaller one (C5)', () => {
    const h = settleShares([bid('b1', 'm3', 'a1', 25), bid('b2', 'm3', 'a2', 10), bid('b3', 'm3', 'a3', 5)], { m3: 30 }, 20, 6);
    expect(h.map((x) => x.athleteId)).toEqual(['a1', 'a3']);
  });

  it('counts only kept buys toward the pool', () => {
    const h = settleShares([bid('b1', 'm3', 'a1', 25), bid('b2', 'm1', 'a1', 10)], { m3: 20, m1: 50 }, 20, 6);
    expect(h).toHaveLength(1);
    expect(share(h, 'm1', 'a1')).toBeCloseTo(0.5);
  });

  it('caps the roster at the largest buys, ties by earliest then id', () => {
    const h = settleShares(
      [bid('b1', 'm1', 'a1', 10, 5), bid('b2', 'm1', 'a2', 10, 1), bid('b3', 'm1', 'a3', 5)],
      { m1: 100 }, 20, 2,
    );
    expect(h.map((x) => x.athleteId)).toEqual(['a1', 'a2']);
    const same = settleShares([bid('b9', 'm1', 'a1', 10), bid('b3', 'm1', 'a2', 10), bid('b5', 'm1', 'a3', 10)], { m1: 100 }, 20, 2);
    expect(same.map((x) => x.bidId)).toEqual(['b3', 'b5']);
  });

  it('gives no holding for 0 credits or a manager without a budget', () => {
    expect(settleShares([bid('b1', 'm1', 'a1', 0), bid('b2', 'ghost', 'a1', 5)], { m1: 10 }, 20, 6)).toEqual([]);
  });
});
