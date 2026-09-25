import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { athleteWeekScore, rawScore, type StatLine } from './scoring';

const s = parseSettings({ normalize_mode: 'per_point' });
const line = (over: Partial<StatLine> = {}): StatLine => ({
  athleteId: 'a1',
  sessionType: 'practice',
  pointsPlayed: 10,
  stats: { goal: 2, assist: 1 }, // raw = 2*3 + 1*3 = 9
  ...over,
});

describe('rawScore', () => {
  it('weights each stat and ignores unknown stats', () => {
    expect(rawScore({ goal: 2, assist: 1, layout: 5 }, s.stat_weights)).toBe(9);
    expect(rawScore({ goal: 1, turnover: 1 }, s.stat_weights)).toBe(1);
  });
});

describe('athleteWeekScore', () => {
  it('divides by points played in per_point mode', () => {
    expect(athleteWeekScore([line()], s)).toBeCloseTo(0.9);
  });

  it('doubles tournament stats', () => {
    expect(athleteWeekScore([line({ sessionType: 'tournament' })], s)).toBeCloseTo(1.8);
  });

  it('divides mixed weeks by total (unweighted) points played', () => {
    const score = athleteWeekScore([line(), line({ sessionType: 'tournament' })], s);
    expect(score).toBeCloseTo((9 + 18) / 20);
  });

  it('floors the denominator so tiny or zero points played stay finite', () => {
    expect(athleteWeekScore([line({ pointsPlayed: 0, stats: { goal: 1 } })], s)).toBeCloseTo(3 / 5);
    expect(athleteWeekScore([line({ pointsPlayed: 0, stats: { turnover: 4 } })], s)).toBeCloseTo(-8 / 5);
  });

  it('supports raw totals and other scales', () => {
    expect(athleteWeekScore([line()], parseSettings({ normalize_mode: 'none' }))).toBe(9);
    expect(athleteWeekScore([line()], parseSettings({ normalize_mode: 'per_point', normalize_per_points: 10 }))).toBeCloseTo(9);
  });

  it('returns absent_score when the athlete has no counted sessions', () => {
    expect(athleteWeekScore([], s)).toBe(0);
    expect(athleteWeekScore([], parseSettings({ absent_score: -1 }))).toBe(-1);
  });
});
