import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { applyDelta, matchupDeltas, rankSnapshot, type StandingRow } from './points';

const s = parseSettings({});
const rows: StandingRow[] = [
  { managerId: 'm1', points: 9, totalScore: 10 },
  { managerId: 'm2', points: 6, totalScore: 10 },
  { managerId: 'm3', points: 6, totalScore: 8 },
  { managerId: 'm4', points: 0, totalScore: 1 },
];
const ranks = rankSnapshot(rows);

describe('rankSnapshot', () => {
  it('ranks by points then total score', () => {
    expect(ranks).toEqual({ m1: 1, m2: 2, m3: 3, m4: 4 });
  });
  it('gives fully tied managers their average rank (week 1: everyone tied)', () => {
    const start = ['a', 'b', 'c', 'd'].map((id) => ({ managerId: id, points: 0, totalScore: 0 }));
    expect(rankSnapshot(start)).toEqual({ a: 2.5, b: 2.5, c: 2.5, d: 2.5 });
  });
});

describe('matchupDeltas', () => {
  it('pays an underdog upset double and costs the favorite double (k = 1)', () => {
    const d = matchupDeltas({ managerId: 'm4', score: 5 }, { managerId: 'm1', score: 2 }, ranks, 4, s);
    expect(d).toEqual({ m4: 6, m1: -2 });
  });
  it('pays a favorite almost nothing for beating the last-place team', () => {
    const d = matchupDeltas({ managerId: 'm1', score: 5 }, { managerId: 'm4', score: 2 }, ranks, 4, s);
    expect(d).toEqual({ m1: 0, m4: 0 });
  });
  it('uses base points between equally ranked managers', () => {
    const tied = rankSnapshot(rows.map((r) => ({ ...r, points: 0, totalScore: 0 })));
    const d = matchupDeltas({ managerId: 'm2', score: 5 }, { managerId: 'm3', score: 2 }, tied, 4, s);
    expect(d).toEqual({ m2: 3, m3: -1 });
  });
  it('supports fixed mode', () => {
    const d = matchupDeltas({ managerId: 'm4', score: 5 }, { managerId: 'm1', score: 2 }, ranks, 4, parseSettings({ points_mode: 'fixed' }));
    expect(d).toEqual({ m4: 3, m1: -1 });
  });
  it('treats scores within 0.01 as a tie', () => {
    const d = matchupDeltas({ managerId: 'm1', score: 1.004 }, { managerId: 'm2', score: 1 }, ranks, 4, s);
    expect(d).toEqual({ m1: 1, m2: 1 });
  });
  it('falls back to a middle rank for a manager missing from the snapshot', () => {
    const d = matchupDeltas({ managerId: 'new', score: 5 }, { managerId: 'm2', score: 2 }, { m2: 2 }, 3, s);
    expect(d.new).toBeCloseTo(3);
  });
});

describe('applyDelta', () => {
  it('allows negatives unless a floor is set', () => {
    expect(applyDelta(1, -2, s)).toBe(-1);
    expect(applyDelta(1, -2, parseSettings({ standings_floor: 0 }))).toBe(0);
  });
});
