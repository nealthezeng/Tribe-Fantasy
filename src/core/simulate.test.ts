import { describe, expect, it } from 'vitest';
import { simulateYear } from './simulate';

const cfg = { managers: 6, athletes: 24, stages: 3, weeksPerStage: 3, seed: 'test' };

describe('simulateYear', () => {
  const r = simulateYear(cfg);

  it('plays every week of every stage to a final result', () => {
    expect(r.result.weeks).toHaveLength(9);
    expect(r.result.weeks.every((w) => w.status === 'final')).toBe(true);
    expect(r.placesByStage).toHaveLength(3);
  });

  it('deals full, exclusive rosters each stage', () => {
    for (const st of ['s00', 's01', 's02']) {
      const slots = r.input.slots.filter((x) => x.stageId === st);
      expect(slots).toHaveLength(24);
      expect(new Set(slots.map((x) => x.athleteId)).size).toBe(24);
    }
  });

  it('keeps standings points equal to the sum of weekly deltas', () => {
    for (const row of r.result.standings) {
      const sum = r.result.weeks.flatMap((w) => w.matchups.flatMap((m) => [m.home, m.away]))
        .filter((x) => x?.membershipId === row.membershipId).reduce((acc, x) => acc + (x!.delta ?? 0), 0);
      expect(row.points).toBeCloseTo(sum);
    }
  });

  it('is deterministic per seed, and a tanker changes only their own last-week picks', () => {
    expect(simulateYear(cfg)).toEqual(r);
    const t = simulateYear({ ...cfg, tanker: 0 });
    expect(t.input.statLines).toEqual(r.input.statLines);
    const changed = t.input.picks.filter((p, i) => p.athleteId !== r.input.picks[i]?.athleteId);
    // Rosters may differ from stage 2 on (allowance moved), so only check stage 1 strictly.
    const stage1 = changed.filter((p) => ['w00', 'w01', 'w02'].includes(p.weekId));
    expect(stage1).toEqual([expect.objectContaining({ membershipId: 'm00', weekId: 'w02' })]);
  });
});
