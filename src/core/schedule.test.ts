import { describe, expect, it } from 'vitest';
import { roundRobin } from './schedule';

const key = (a: string, b: string) => [a, b].sort().join('-');

describe('roundRobin', () => {
  it('pairs every manager with every other exactly once per round (even count)', () => {
    const weeks = roundRobin(['d', 'c', 'b', 'a'], 3);
    const seen = new Set<string>();
    for (const week of weeks) {
      expect(week.flat().sort()).toEqual(['a', 'b', 'c', 'd']);
      for (const [x, y] of week) seen.add(key(x, y!));
    }
    expect(seen.size).toBe(6);
  });

  it('gives each manager exactly one bye per round (odd count)', () => {
    const weeks = roundRobin(['a', 'b', 'c', 'd', 'e'], 5);
    const byes: Record<string, number> = {};
    const pairs = new Set<string>();
    for (const week of weeks) {
      for (const [x, y] of week) {
        if (y === null) byes[x] = (byes[x] ?? 0) + 1;
        else pairs.add(key(x, y));
      }
    }
    expect(byes).toEqual({ a: 1, b: 1, c: 1, d: 1, e: 1 });
    expect(pairs.size).toBe(10);
  });

  it('repeats rounds in order when the season is longer than one round robin', () => {
    const weeks = roundRobin(['a', 'b', 'c', 'd'], 7);
    expect(weeks).toHaveLength(7);
    expect(weeks[3]).toEqual(weeks[0]);
    expect(weeks[6]).toEqual(weeks[0]);
  });

  it('handles tiny leagues', () => {
    expect(roundRobin(['a'], 2)).toEqual([[['a', null]], [['a', null]]]);
    expect(roundRobin([], 2)).toEqual([[], []]);
  });
});
