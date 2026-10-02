import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { tirednessMultiplier } from './tiredness';

const s = parseSettings({});

describe('tirednessMultiplier', () => {
  it('is ×0.5 right after a start, ×0.75 two games on, then fully rested', () => {
    expect(tirednessMultiplier(1, s)).toBe(0.5);
    expect(tirednessMultiplier(2, s)).toBe(0.75);
    expect(tirednessMultiplier(3, s)).toBe(1);
    expect(tirednessMultiplier(10, s)).toBe(1);
  });

  it('is 1 for an athlete who has not started this tournament', () => {
    expect(tirednessMultiplier(null, s)).toBe(1);
  });

  it('follows the setting, and an empty list turns tiredness off', () => {
    expect(tirednessMultiplier(1, parseSettings({ tiredness_multipliers: [0.3, 0.6, 0.9] }))).toBe(0.3);
    expect(tirednessMultiplier(3, parseSettings({ tiredness_multipliers: [0.3, 0.6, 0.9] }))).toBe(0.9);
    expect(tirednessMultiplier(1, parseSettings({ tiredness_multipliers: [] }))).toBe(1);
  });

  it('throws on a gap below 1 (a caller bug: the same game twice)', () => {
    expect(() => tirednessMultiplier(0, s)).toThrow();
    expect(() => tirednessMultiplier(1.5, s)).toThrow();
  });
});
