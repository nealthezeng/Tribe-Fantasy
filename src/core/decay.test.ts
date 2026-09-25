import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { resolveAcquiredWeek, tenureMultiplier, type OwnershipRecord } from './decay';

const s = parseSettings({});

describe('tenureMultiplier', () => {
  it('is 1 through the grace period', () => {
    expect(tenureMultiplier(0, 0, s)).toBe(1);
    expect(tenureMultiplier(2, 0, s)).toBe(1);
  });
  it('decays exponentially after grace, down to the floor', () => {
    expect(tenureMultiplier(3, 0, s)).toBeCloseTo(0.95);
    expect(tenureMultiplier(4, 0, s)).toBeCloseTo(0.9025);
    expect(tenureMultiplier(100, 0, s)).toBe(0.5);
  });
  it('supports linear and none', () => {
    const lin = parseSettings({ decay_mode: 'linear' });
    expect(tenureMultiplier(5, 0, lin)).toBeCloseTo(0.85);
    expect(tenureMultiplier(100, 0, lin)).toBe(0.5);
    expect(tenureMultiplier(100, 0, parseSettings({ decay_mode: 'none' }))).toBe(1);
  });
  it('restarts for a newly acquired athlete', () => {
    expect(tenureMultiplier(9, 8, s)).toBe(1);
  });
  it('never exceeds 1 even if acquiredWeek is in the future', () => {
    expect(tenureMultiplier(1, 5, s)).toBe(1);
  });
});

describe('resolveAcquiredWeek', () => {
  const history: OwnershipRecord[] = [
    { managerId: 'm1', athleteId: 'a1', acquiredWeek: 0, releasedWeek: 3 },
    { managerId: 'm2', athleteId: 'a1', acquiredWeek: 3, releasedWeek: null },
  ];
  it('starts fresh for a first-time owner', () => {
    expect(resolveAcquiredWeek(history, 'm3', 'a1', 5, s)).toBe(5);
  });
  it('restores old tenure when an athlete returns within the window', () => {
    expect(resolveAcquiredWeek(history, 'm1', 'a1', 7, s)).toBe(0);
  });
  it('starts fresh once the window has passed', () => {
    expect(resolveAcquiredWeek(history, 'm1', 'a1', 8, s)).toBe(8);
  });
  it('uses the most recent release when there are several', () => {
    const h: OwnershipRecord[] = [
      ...history,
      { managerId: 'm1', athleteId: 'a1', acquiredWeek: 4, releasedWeek: 6 },
    ];
    expect(resolveAcquiredWeek(h, 'm1', 'a1', 8, s)).toBe(4);
  });
});
