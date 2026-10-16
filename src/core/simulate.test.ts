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

  it("every team's roster ≤ roster_size, shares in (0, 1], every game has ≤ 2 starters per side", () => {
    for (const st of ['s00', 's01', 's02']) {
      for (const m of r.managerIds) {
        const mine = r.input.slots.filter((x) => x.stageId === st && x.membershipId === m);
        expect(mine.length).toBeGreaterThan(0);
        expect(mine.length).toBeLessThanOrEqual(r.settings.roster_size);
      }
    }
    expect(r.input.slots.every((x) => x.share > 0 && x.share <= 1)).toBe(true);
    expect(sidesOf(r).every((sd) => sd.athleteIds.length >= 1 && sd.athleteIds.length <= 2)).toBe(true);
  });

  it('keeps standings points equal to the sum of game deltas', () => {
    for (const row of r.result.standings) {
      const sum = sidesOf(r).filter((x) => x.membershipId === row.membershipId).reduce((acc, x) => acc + (x.delta ?? 0), 0);
      expect(row.points).toBeCloseTo(sum);
    }
  });

  it('avoids rematches within a tournament while fresh opponents remain', () => {
    // Games 1–3 of 6 teams can always be rematch-free; after that Swiss, pairing game by game, may be forced into one.
    for (const st of ['s00', 's01', 's02']) {
      const first = r.result.games.filter((g) => g.game.stageId === st && g.game.number <= 3);
      const keys = first.flatMap((g) => g.matchups.map((m) => [m.home.membershipId, m.away!.membershipId].sort().join('|')));
      expect(new Set(keys).size).toBe(9);
    }
  });

  it('honest managers weigh tiredness: they play tired far less than a repeater', () => {
    const t = simulateYear({ ...cfg, repeater: 0 });
    const tiredShare = (x: ReturnType<typeof simulateYear>) => {
      const mine = sidesOf(x).filter((sd) => sd.membershipId === 'm00');
      const starts = mine.flatMap((sd) => sd.athleteIds.map((x) => sd.rest[x]));
      return starts.filter((x) => x < 1).length / starts.length;
    };
    // Shares blunt this: a tired 50% share can still beat a rested 20% one.
    expect(tiredShare(t)).toBeGreaterThan(tiredShare(r) + 0.2);
  });

  it('is deterministic per seed; a tanker changes only their own last-game pick in tournament 1', () => {
    expect(simulateYear(cfg)).toEqual(r);
    const t = simulateYear({ ...cfg, tanker: 0 });
    expect(t.input.statLines).toEqual(r.input.statLines);
    const stage1 = t.input.picks.filter((p, i) => p.stageId === 's00' && p.athleteId !== r.input.picks[i].athleteId);
    expect(stage1.length).toBeGreaterThan(0);
    expect(stage1.every((p) => p.membershipId === 'm00' && p.number === 5)).toBe(true);
  });
});
