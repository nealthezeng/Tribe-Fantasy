export type SessionType = 'practice' | 'tournament';

export interface SeasonSettings {
  credits_per_dollar: number;
  donations_enabled: boolean;
  /** The treasurer's Venmo username (no @), shown with each team's donation code. Null = no Venmo box. */
  venmo_handle: string | null;
  allowance_base: number;
  allowance_gap: number;
  max_members: number;
  roster_size: number;
  /** Roster athletes kept on the bench; they play only after a swap for an injured active athlete. */
  bench_size: number;
  min_bid: number;
  exclusive_ownership: boolean;
  allow_self_ownership: boolean;
  stat_weights: Record<string, number>;
  normalize_mode: 'per_point' | 'none';
  normalize_per_points: number;
  min_points_denominator: number;
  session_multipliers: Record<SessionType, number>;
  absent_score: number;
  points_mode: 'fixed' | 'rank_weighted';
  win_points: number;
  loss_points: number;
  tie_points: number;
  upset_k: number;
  standings_floor: number | null;
  decay_mode: 'exponential' | 'linear' | 'none';
  decay_grace_stages: number;
  decay_rate: number;
  decay_floor: number;
  /** Tournament mode: factor for an athlete who started 1, 2, … games ago for the same manager; past the list = 1. */
  tiredness_multipliers: number[];
  default_pick: 'best_unused' | 'forfeit';
  stat_lock_hours: number;
  tap_merge_seconds: number;
}

export const DEFAULT_SETTINGS: SeasonSettings = {
  credits_per_dollar: 20,
  donations_enabled: false,
  venmo_handle: null,
  allowance_base: 100,
  allowance_gap: 30,
  max_members: 6,
  roster_size: 4,
  bench_size: 1,
  min_bid: 1,
  exclusive_ownership: true,
  allow_self_ownership: false,
  stat_weights: { goal: 3, assist: 3, block: 3, callahan: 8, turnover: -2 },
  normalize_mode: 'none',
  normalize_per_points: 1,
  min_points_denominator: 5,
  session_multipliers: { practice: 1, tournament: 2 },
  absent_score: 0,
  points_mode: 'rank_weighted',
  win_points: 3,
  loss_points: 1,
  tie_points: 1,
  upset_k: 0.5,
  standings_floor: null,
  decay_mode: 'exponential',
  decay_grace_stages: 1,
  decay_rate: 0.9,
  decay_floor: 0.6,
  tiredness_multipliers: [0.5, 0.75],
  default_pick: 'best_unused',
  stat_lock_hours: 48,
  tap_merge_seconds: 10,
};

export class SettingsError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid season settings: ${issues.join('; ')}`);
    this.name = 'SettingsError';
    this.issues = issues;
  }
}

type Check = (v: unknown) => string | null;

const num =
  (min: number, max: number, int = false): Check =>
  (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return 'must be a finite number';
    if (v < min || v > max) return `must be between ${min} and ${max}`;
    if (int && !Number.isInteger(v)) return 'must be a whole number';
    return null;
  };
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null ? null : check(v);
const oneOf =
  (...options: string[]): Check =>
  (v) =>
    typeof v === 'string' && options.includes(v) ? null : `must be one of: ${options.join(', ')}`;
const bool: Check = (v) => (typeof v === 'boolean' ? null : 'must be true or false');
const numberMap: Check = (v) => {
  if (!isPlainObject(v)) return 'must be an object of numbers';
  for (const [k, x] of Object.entries(v)) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return `entry "${k}" must be a finite number`;
  }
  return null;
};
// Same rule as the stat_taps.stat check in 0004_stats.sql; a key it refuses would make every save of that stat fail.
const STAT_NAME = /^[a-z_]{1,30}$/;
const statWeights: Check = (v) => {
  const problem = numberMap(v);
  if (problem) return problem;
  const bad = Object.keys(v as object).find((k) => !STAT_NAME.test(k));
  return bad === undefined ? null : `key "${bad}" must be 1-30 lowercase letters or underscores`;
};

const CHECKS: Record<keyof SeasonSettings, Check> = {
  credits_per_dollar: num(1, 10_000, true),
  donations_enabled: bool,
  venmo_handle: nullable((v) =>
    typeof v === 'string' && /^[A-Za-z0-9_-]{5,30}$/.test(v) ? null : 'must be a Venmo username: 5-30 letters, digits, - or _ (no @)'),
  allowance_base: num(0, 100_000, true),
  allowance_gap: num(0, 100_000, true),
  max_members: num(2, 50, true),
  roster_size: num(1, 30, true),
  bench_size: num(0, 5, true),
  min_bid: num(0, 10_000_000, true),
  exclusive_ownership: bool,
  allow_self_ownership: bool,
  stat_weights: statWeights,
  normalize_mode: oneOf('per_point', 'none'),
  normalize_per_points: num(0.001, 1000),
  min_points_denominator: num(1, 1000),
  session_multipliers: numberMap,
  absent_score: num(-1000, 1000),
  points_mode: oneOf('fixed', 'rank_weighted'),
  win_points: num(0, 1000),
  loss_points: num(0, 1000),
  tie_points: num(-1000, 1000),
  upset_k: num(0, 10),
  standings_floor: nullable(num(-1_000_000, 1_000_000)),
  decay_mode: oneOf('exponential', 'linear', 'none'),
  decay_grace_stages: num(0, 20, true),
  decay_rate: num(0, 1),
  decay_floor: num(0, 1),
  tiredness_multipliers: (v) =>
    Array.isArray(v) && v.length <= 10 && v.every((x) => typeof x === 'number' && x >= 0 && x <= 1)
      ? null : 'must be a list of up to 10 numbers between 0 and 1',
  default_pick: oneOf('best_unused', 'forfeit'),
  stat_lock_hours: num(0, 720),
  tap_merge_seconds: num(0, 60),
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseSettings(input: unknown): SeasonSettings {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (input === undefined || input === null) return base;
  if (!isPlainObject(input)) throw new SettingsError(['settings must be an object']);

  const issues: string[] = [];
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(CHECKS, key)) issues.push(`unknown setting "${key}"`);
  }

  // Validate session_multipliers keys before merging
  if (isPlainObject(input.session_multipliers)) {
    for (const key of Object.keys(input.session_multipliers)) {
      if (key !== 'practice' && key !== 'tournament') {
        issues.push(`session_multipliers has unknown session type "${key}"`);
      }
    }
  }

  const merged = { ...base, ...structuredClone(input) } as Record<string, unknown>;
  if (isPlainObject(input.session_multipliers)) {
    merged.session_multipliers = { ...base.session_multipliers, ...input.session_multipliers };
  }

  for (const [key, check] of Object.entries(CHECKS)) {
    const problem = check(merged[key]);
    if (problem) issues.push(`${key} ${problem}`);
  }
  if (issues.length === 0 && (merged.bench_size as number) >= (merged.roster_size as number)) {
    issues.push('bench_size must be less than roster_size');
  }
  if (issues.length > 0) throw new SettingsError(issues);

  for (const key of Object.keys(merged)) if (!Object.hasOwn(CHECKS, key)) delete merged[key];
  return merged as unknown as SeasonSettings;
}
