import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings, SettingsError } from './settings';

describe('parseSettings', () => {
  it('returns the spec defaults for empty input', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('has the agreed money and scoring defaults', () => {
    expect(DEFAULT_SETTINGS.credits_per_dollar).toBe(20);
    expect(DEFAULT_SETTINGS.donations_enabled).toBe(false);
    expect(DEFAULT_SETTINGS.allowance_base).toBe(100);
    expect(DEFAULT_SETTINGS.allowance_gap).toBe(30);
    expect(DEFAULT_SETTINGS.max_members).toBe(6);
    expect(DEFAULT_SETTINGS.roster_size).toBe(4);
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

  it('bounds the M4 wallet and league-size settings', () => {
    for (const bad of [{ max_members: 1 }, { max_members: 51 }, { allowance_base: -1 }, { allowance_gap: 2.5 },
      { donations_enabled: 'yes' }]) {
      expect(() => parseSettings(bad), JSON.stringify(bad)).toThrow(SettingsError);
    }
    expect(parseSettings({ max_members: 8, roster_size: 3 }).max_members).toBe(8);
  });

  it('has the stage decay defaults (stages revision §4)', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ decay_grace_stages: 1, decay_rate: 0.9, decay_floor: 0.6, upset_k: 0.5 });
  });

  it('rejects the weekly settings retired by tournament mode (T4; 0013 strips them from stored seasons)', () => {
    for (const key of ['pick_lock_day', 'pick_lock_time', 'usage_reset']) {
      expect(() => parseSettings({ [key]: 'mon' })).toThrow(`unknown setting "${key}"`);
    }
  });

  it('has the tournament bench and tiredness defaults (tournament mode §3)', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ bench_size: 1, tiredness_multipliers: [0.5, 0.75] });
  });

  it('takes a tiredness list of up to 10 factors in [0, 1]', () => {
    expect(parseSettings({ tiredness_multipliers: [] }).tiredness_multipliers).toEqual([]);
    expect(parseSettings({ tiredness_multipliers: [0, 1] }).tiredness_multipliers).toEqual([0, 1]);
    for (const bad of [{ tiredness_multipliers: 0.5 }, { tiredness_multipliers: [1.1] }, { tiredness_multipliers: [-0.1] },
      { tiredness_multipliers: ['x'] }, { tiredness_multipliers: Array(11).fill(1) }]) {
      expect(() => parseSettings(bad), JSON.stringify(bad)).toThrow(/tiredness_multipliers/);
    }
  });

  it('keeps at least one active athlete: bench_size < roster_size', () => {
    expect(parseSettings({ roster_size: 3, bench_size: 0 }).bench_size).toBe(0);
    expect(() => parseSettings({ roster_size: 3, bench_size: 3 })).toThrow(/bench_size must be less than roster_size/);
    expect(() => parseSettings({ bench_size: 1.5 })).toThrow(/bench_size/);
  });

  it('rejects the settings retired by the stages revision', () => {
    for (const key of ['min_credits_to_play', 'free_entry', 'extra_credit_cap', 'decay_grace_weeks', 'decay_return_window',
      'trade_review_hours', 'trade_keeps_usage']) {
      expect(() => parseSettings({ [key]: null })).toThrow(`unknown setting "${key}"`);
    }
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

describe('venmo_handle', () => {
  it('defaults to null and accepts a Venmo username without @', () => {
    expect(DEFAULT_SETTINGS.venmo_handle).toBeNull();
    expect(parseSettings({ venmo_handle: 'Tribe-Fund_23' }).venmo_handle).toBe('Tribe-Fund_23');
  });
  it('rejects @, spaces and bad lengths', () => {
    for (const bad of ['@tribe', 'tri be', 'abcd', 'x'.repeat(31), 5]) {
      expect(() => parseSettings({ venmo_handle: bad }), String(bad)).toThrow(/venmo_handle/);
    }
  });
});
