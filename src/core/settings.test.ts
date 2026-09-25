import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, SettingsError } from './settings';

describe('parseSettings', () => {
  it('returns the spec defaults for empty input', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('has the agreed money and scoring defaults', () => {
    expect(DEFAULT_SETTINGS.credits_per_dollar).toBe(20);
    expect(DEFAULT_SETTINGS.min_credits_to_play).toBe(100);
    expect(DEFAULT_SETTINGS.extra_credit_cap).toBeNull();
    expect(DEFAULT_SETTINGS.normalize_mode).toBe('none');
    expect(DEFAULT_SETTINGS.stat_weights).toEqual({ goal: 3, assist: 3, block: 3, callahan: 8, turnover: -2 });
    expect(DEFAULT_SETTINGS.tap_merge_seconds).toBe(10);
    expect(DEFAULT_SETTINGS.normalize_per_points).toBe(1);
    expect(DEFAULT_SETTINGS.points_mode).toBe('rank_weighted');
  });

  it('overrides individual keys', () => {
    const s = parseSettings({ roster_size: 6, decay_mode: 'none' });
    expect(s.roster_size).toBe(6);
    expect(s.decay_mode).toBe('none');
    expect(s.win_points).toBe(DEFAULT_SETTINGS.win_points);
  });

  it('merges a partial session_multipliers map over the defaults', () => {
    const s = parseSettings({ session_multipliers: { tournament: 3 } });
    expect(s.session_multipliers).toEqual({ practice: 1, tournament: 3 });
  });

  it('replaces stat_weights wholesale so stats can be removed', () => {
    const s = parseSettings({ stat_weights: { goal: 1 } });
    expect(s.stat_weights).toEqual({ goal: 1 });
  });

  it('rejects unknown keys by name (catches typos)', () => {
    expect(() => parseSettings({ decay_rat: 0.9 })).toThrow(/unknown setting "decay_rat"/);
  });

  it('collects every invalid value', () => {
    try {
      parseSettings({ roster_size: 0, decay_mode: 'wobbly', win_points: 'three' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SettingsError);
      const issues = (e as SettingsError).issues.join('\n');
      expect(issues).toMatch(/roster_size/);
      expect(issues).toMatch(/decay_mode/);
      expect(issues).toMatch(/win_points/);
    }
  });

  it('rejects non-objects and non-finite numbers', () => {
    expect(() => parseSettings([1])).toThrow(SettingsError);
    expect(() => parseSettings({ upset_k: Number.NaN })).toThrow(/upset_k/);
    expect(() => parseSettings({ tap_merge_seconds: 61 })).toThrow(/tap_merge_seconds/);
    expect(() => parseSettings({ stat_weights: { goal: 'x' } })).toThrow(/stat_weights/);
  });

  it('only takes stat names the database can store (lowercase letters and _, up to 30)', () => {
    for (const bad of ['Goal', 'hockey-assist', 'layout d', '', 'a'.repeat(31)]) {
      expect(() => parseSettings({ stat_weights: { [bad]: 1 } })).toThrow(/stat_weights key/);
    }
    expect(parseSettings({ stat_weights: { hand_block: 2, ['a'.repeat(30)]: 1 } }).stat_weights.hand_block).toBe(2);
  });

  it('does not share nested objects with DEFAULT_SETTINGS', () => {
    const s = parseSettings({});
    s.stat_weights.goal = 99;
    expect(DEFAULT_SETTINGS.stat_weights.goal).toBe(3);
  });

  it('rejects inherited Object.prototype keys', () => {
    expect(() => parseSettings({ toString: 'x' })).toThrow(/unknown setting "toString"/);
  });

  it('rejects unknown session types in session_multipliers', () => {
    expect(() => parseSettings({ session_multipliers: { tournamnet: 3 } })).toThrow(/unknown session type "tournamnet"/);
  });
});
