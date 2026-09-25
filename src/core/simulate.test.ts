import { describe, expect, it } from 'vitest';
import { simulateSeason } from './simulate';

describe('simulateSeason', () => {
  const r = simulateSeason({ managers: 6, athletes: 30, weeks: 10, seed: 'test', tournamentWeeks: [4, 8] });

  it('drafts full, exclusive rosters', () => {
    const all = Object.values(r.rosters).flat();
    expect(Object.values(r.rosters).every((roster) => roster.length === 5)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it('never repeats an athlete within a cycle', () => {
    for (const managerId of Object.keys(r.rosters)) {
      const mine = r.picks.filter((p) => p.managerId === managerId).sort((a, b) => a.week - b.week);
      expect(mine).toHaveLength(10);
      expect(new Set(mine.slice(0, 5).map((p) => p.athleteId)).size).toBe(5);
      expect(new Set(mine.slice(5, 10).map((p) => p.athleteId)).size).toBe(5);
    }
  });

  it('keeps standings equal to the sum of weekly deltas', () => {
    for (const row of r.standings) {
      const sum = r.weeks.flatMap((w) => w.matchups)
        .flatMap((m) => [m.home, m.away])
        .filter((side) => side?.managerId === row.managerId)
        .reduce((acc, side) => acc + side!.delta, 0);
      expect(row.points).toBeCloseTo(sum);
    }
  });

  it('is deterministic per seed', () => {
    expect(simulateSeason({ managers: 6, athletes: 30, weeks: 10, seed: 'test', tournamentWeeks: [4, 8] })).toEqual(r);
  });

  it('copes with more roster capacity than athletes and an odd manager count', () => {
    const odd = simulateSeason({ managers: 7, athletes: 30, weeks: 6, seed: 'odd' });
    expect(Object.values(odd.rosters).flat()).toHaveLength(30);
    expect(odd.weeks).toHaveLength(6);
  });
});
