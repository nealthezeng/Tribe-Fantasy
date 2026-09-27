import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { stageMultiplier } from './decay';

const s = parseSettings({});

describe('stageMultiplier', () => {
  it('is 1 for a first start and through the one-stage grace', () => {
    expect(stageMultiplier(0, s)).toBe(1);
    expect(stageMultiplier(1, s)).toBe(1);
  });
  it('decays 0.9 per stage after the grace, down to the 0.6 floor', () => {
    expect(stageMultiplier(2, s)).toBeCloseTo(0.9);
    expect(stageMultiplier(3, s)).toBeCloseTo(0.81);
    expect(stageMultiplier(20, s)).toBe(0.6);
  });
  it('supports linear and none', () => {
    const lin = parseSettings({ decay_mode: 'linear' });
    expect(stageMultiplier(3, lin)).toBeCloseTo(0.8);
    expect(stageMultiplier(20, lin)).toBe(0.6);
    expect(stageMultiplier(20, parseSettings({ decay_mode: 'none' }))).toBe(1);
  });
});
