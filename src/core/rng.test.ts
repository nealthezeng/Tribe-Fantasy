import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, seededShuffle } from './rng';

describe('rng', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = mulberry32(hashSeed('x'));
    const b = mulberry32(hashSeed('x'));
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('shuffles deterministically without losing items or mutating input', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const s1 = seededShuffle(items, 'seed');
    expect(seededShuffle(items, 'seed')).toEqual(s1);
    expect([...s1].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(seededShuffle(items, 'other')).not.toEqual(s1);
  });
});
