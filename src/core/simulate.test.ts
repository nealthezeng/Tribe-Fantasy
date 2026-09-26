import { describe, expect, it } from 'vitest';
import { simulateSeason } from './simulate';

describe('simulateSeason', () => {
  const r = simulateSeason({ managers: 6, athletes: 30, weeks: 10, seed: 'test', tournamentWeeks: [4, 8], settings: { roster_size: 5 } });

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

  it('default-picks the unused athlete with the best week-1 score in week 2', () => {
    const w1 = r.weeks[0].athleteScores;
    let notAlphabetical = 0;
    for (const [managerId, roster] of Object.entries(r.rosters)) {
      const first = r.picks.find((p) => p.week === 1 && p.managerId === managerId)!.athleteId;
      const unused = roster.filter((a) => a !== first);
      expect(unused.every((a) => a in w1)).toBe(true);
      const best = [...unused].sort((a, b) => w1[b] - w1[a] || (a < b ? -1 : 1))[0];
      expect(r.picks.find((p) => p.week === 2 && p.managerId === managerId)!.athleteId).toBe(best);
      if (best !== unused[0]) notAlphabetical++;
    }
    expect(notAlphabetical).toBeGreaterThan(0);
  });

  it('is deterministic per seed', () => {
    expect(simulateSeason({ managers: 6, athletes: 30, weeks: 10, seed: 'test', tournamentWeeks: [4, 8], settings: { roster_size: 5 } })).toEqual(r);
  });

  it('copes with more roster capacity than athletes and an odd manager count', () => {
    const odd = simulateSeason({ managers: 7, athletes: 30, weeks: 6, seed: 'odd', settings: { roster_size: 5 } });
    expect(Object.values(odd.rosters).flat()).toHaveLength(30);
    expect(odd.weeks).toHaveLength(6);
  });
});
