import { describe, expect, it } from 'vitest';
import { simulateYear } from './simulate';

const cfg = { managers: 6, athletes: 24, stages: 3, gamesPerStage: 5, seed: 'test' };
const sidesOf = (r: ReturnType<typeof simulateYear>) =>
  r.result.games.flatMap((g) => g.matchups.flatMap((m) => [m.home, m.away!]));

describe('simulateYear', () => {
  const r = simulateYear(cfg);

  it('plays every game of every tournament to a final result, three matchups each', () => {
    expect(r.result.games).toHaveLength(15);
    expect(r.result.games.every((g) => g.status === 'final' && g.matchups.length === 3)).toBe(true);
    expect(r.placesByStage).toHaveLength(3);
  });

  it('deals full, exclusive rosters each tournament with one bench athlete per team', () => {
    for (const st of ['s00', 's01', 's02']) {
      const slots = r.input.slots.filter((x) => x.stageId === st);
      expect(slots).toHaveLength(24);
      expect(new Set(slots.map((x) => x.athleteId)).size).toBe(24);
      expect(slots.filter((x) => x.bench)).toHaveLength(6);
    }
  });

  it('keeps standings points equal to the sum of game deltas', () => {
    for (const row of r.result.standings) {
      const sum = sidesOf(r).filter((x) => x.membershipId === row.membershipId).reduce((acc, x) => acc + (x.delta ?? 0), 0);
      expect(row.points).toBeCloseTo(sum);
    }
  });

  it('avoids rematches within a tournament while fresh opponents remain', () => {
    const first = r.result.games.filter((g) => g.game.stageId === 's00');
    const keys = first.flatMap((g) => g.matchups.map((m) => [m.home.membershipId, m.away!.membershipId].sort().join('|')));
    expect(new Set(keys).size).toBe(keys.length); // 5 games × 3 = 15 = every pair of 6 exactly once
  });

  it('honest managers weigh tiredness: they play tired far less than a repeater', () => {
    const t = simulateYear({ ...cfg, repeater: 0 });
    const tiredShare = (x: ReturnType<typeof simulateYear>) => {
      const mine = sidesOf(x).filter((sd) => sd.membershipId === 'm00');
      return mine.filter((sd) => sd.tired! < 1).length / mine.length;
    };
    expect(tiredShare(t)).toBeGreaterThan(tiredShare(r) + 0.3);
  });

  it('is deterministic per seed; a tanker changes only their own last-game pick in tournament 1', () => {
    expect(simulateYear(cfg)).toEqual(r);
    const t = simulateYear({ ...cfg, tanker: 0 });
    expect(t.input.statLines).toEqual(r.input.statLines);
    const stage1 = t.input.picks.filter((p, i) => p.stageId === 's00' && p.athleteId !== r.input.picks[i].athleteId);
    expect(stage1).toEqual([expect.objectContaining({ membershipId: 'm00', number: 5 })]);
  });
});
