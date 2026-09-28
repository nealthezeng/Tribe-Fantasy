import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { pairKey, scoreWeek, type WeekInput } from './week';

const s = parseSettings({ points_mode: 'fixed', normalize_mode: 'per_point' });
const base = (over: Partial<WeekInput> = {}): WeekInput => ({
  settings: s,
  matchups: [{ id: 'x1', home: 'm1', away: 'm2' }, { id: 'x2', home: 'm3', away: null }],
  picks: { m1: 'a1', m2: 'a2', m3: 'a3' },
  statLines: [
    { athleteId: 'a1', sessionType: 'practice', pointsPlayed: 10, stats: { goal: 4 } },
    { athleteId: 'a2', sessionType: 'practice', pointsPlayed: 10, stats: { goal: 1 } },
  ],
  multipliers: { 'm1:a1': 1, 'm2:a2': 1, 'm3:a3': 1 },
  standings: ['m1', 'm2', 'm3'].map((managerId) => ({ managerId, points: 0, totalScore: 0 })),
  ...over,
});

describe('scoreWeek', () => {
  it('scores each side, decides the matchup and updates standings', () => {
    const r = scoreWeek(base());
    expect(r.athleteScores.a1).toBeCloseTo(1.2);
    expect(r.matchups[0].home).toMatchObject({ managerId: 'm1', athleteId: 'a1', multiplier: 1, delta: 3 });
    expect(r.matchups[0].away).toMatchObject({ managerId: 'm2', delta: -1 });
    expect(r.matchups[1].away).toBeNull();
    const pts = Object.fromEntries(r.standings.map((row) => [row.managerId, row.points]));
    expect(pts).toEqual({ m1: 3, m2: -1, m3: 0 });
    expect(r.standings.find((row) => row.managerId === 'm1')!.totalScore).toBeCloseTo(1.2);
  });

  it('applies the degradation multiplier for the picked pair', () => {
    const r = scoreWeek(base({ multipliers: { ...base().multipliers, [pairKey('m1', 'a1')]: 0.9 } }));
    expect(r.matchups[0].home.multiplier).toBeCloseTo(0.9);
    expect(r.matchups[0].home.score).toBeCloseTo(1.2 * 0.9);
  });

  it('throws instead of defaulting when a started pair has no multiplier (gate)', () => {
    expect(() => scoreWeek(base({ multipliers: { 'm2:a2': 1, 'm3:a3': 1 } }))).toThrow(/m1:a1/);
  });

  it('treats a forfeited pick as a score of 0', () => {
    const r = scoreWeek(base({ picks: { m1: null, m2: 'a2', m3: 'a3' } }));
    expect(r.matchups[0].home).toMatchObject({ athleteId: null, score: 0, delta: -1 });
    expect(r.matchups[0].away!.delta).toBe(3);
  });

  it('uses the standings before the week for rank weighting', () => {
    const r = scoreWeek(base({
      settings: parseSettings({ upset_k: 1 }),
      standings: [
        { managerId: 'm1', points: 0, totalScore: 0 },
        { managerId: 'm2', points: 9, totalScore: 9 },
        { managerId: 'm3', points: 3, totalScore: 3 },
      ],
    }));
    expect(r.ranks).toEqual({ m2: 1, m3: 2, m1: 3 });
    expect(r.matchups[0].home.delta).toBeCloseTo(6);
  });

  it('scores unpicked athletes that played, for default-pick history', () => {
    const extra = { athleteId: 'a9', sessionType: 'practice' as const, pointsPlayed: 10, stats: { goal: 4 } };
    const r = scoreWeek(base({ statLines: [...base().statLines, extra] }));
    expect(r.athleteScores.a9).toBeCloseTo(1.2);
  });
});
