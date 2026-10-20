import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';
import { stageMultiplier } from './decay';

const s = DEFAULT_SETTINGS;

describe('stageMultiplier', () => {
  it('is 1 for a first start, then steps down from the first repeat (grace 0)', () => {
    expect(stageMultiplier(0, s)).toBe(1);
    expect(stageMultiplier(1, s)).toBe(0.9);
    expect(stageMultiplier(5, s)).toBe(0.6);
  });
  it('holds at 1 through a grace of N stages when one is set', () => {
    const g1 = parseSettings({ decay_grace_stages: 1 });
    expect(stageMultiplier(1, g1)).toBe(1);
    expect(stageMultiplier(2, g1)).toBeCloseTo(0.9);
  });
  it('decays 0.9 per stage down to the 0.6 floor', () => {
    expect(stageMultiplier(2, s)).toBeCloseTo(0.81);
    expect(stageMultiplier(3, s)).toBeCloseTo(0.729);
    expect(stageMultiplier(20, s)).toBe(0.6);
  });
  it('supports linear and none', () => {
    const lin = parseSettings({ decay_mode: 'linear' });
    expect(stageMultiplier(3, lin)).toBeCloseTo(0.7);
    expect(stageMultiplier(20, lin)).toBe(0.6);
    expect(stageMultiplier(20, parseSettings({ decay_mode: 'none' }))).toBe(1);
  });
});
