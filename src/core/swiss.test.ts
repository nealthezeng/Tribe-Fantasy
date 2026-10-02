import { describe, expect, it } from 'vitest';
import { meetingKey, swissPairings } from './swiss';

const met = (...pairs: [string, string | null][]) => {
  const m: Record<string, number> = {};
  for (const [a, b] of pairs) m[meetingKey(a, b)] = (m[meetingKey(a, b)] ?? 0) + 1;
  return m;
};

describe('swissPairings', () => {
  it('pairs neighbours in the standings, higher-placed team at home', () => {
    expect(swissPairings(['a', 'b', 'c', 'd', 'e', 'f'], {})).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f']]);
  });

  it('avoids a rematch with the nearest available opponent', () => {
    expect(swissPairings(['a', 'b', 'c', 'd'], met(['a', 'b']))).toEqual([['a', 'c'], ['b', 'd']]);
  });

  it('looks ahead instead of dead-ending greedily', () => {
    // Greedy a-b, c-d leaves e-f, who already met; the search finds a rematch-free pairing instead.
    // e can only meet a or b; the closest rematch-free pairings tie on distance, and standings order breaks it.
    expect(swissPairings(['a', 'b', 'c', 'd', 'e', 'f'], met(['e', 'f'], ['c', 'e'], ['d', 'e'])))
      .toEqual([['a', 'c'], ['b', 'e'], ['d', 'f']]);
  });

  it('allows the least-repeated rematch once everyone has met', () => {
    const all = met(['a', 'b'], ['a', 'c'], ['a', 'd'], ['b', 'c'], ['b', 'd'], ['c', 'd'], ['a', 'b'], ['c', 'd']);
    expect(swissPairings(['a', 'b', 'c', 'd'], all)).toEqual([['a', 'c'], ['b', 'd']]);
  });

  it('gives the bye to the lowest-placed team that has not had one', () => {
    expect(swissPairings(['a', 'b', 'c', 'd', 'e'], {})).toEqual([['a', 'b'], ['c', 'd'], ['e', null]]);
    expect(swissPairings(['a', 'b', 'c', 'd', 'e'], met(['e', null]))).toEqual([['a', 'b'], ['c', 'e'], ['d', null]]);
  });

  it('handles 0, 1 and 2 teams', () => {
    expect(swissPairings([], {})).toEqual([]);
    expect(swissPairings(['a'], {})).toEqual([['a', null]]);
    expect(swissPairings(['a', 'b'], met(['a', 'b']))).toEqual([['a', 'b']]);
  });

  it('pairs every team exactly once for 8 teams with history', () => {
    const order = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const pairs = swissPairings(order, met(['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']));
    expect(pairs.flat().sort()).toEqual(order);
    expect(pairs.map(([x, y]) => meetingKey(x, y!))).not.toContain(meetingKey('a', 'b'));
  });
});
