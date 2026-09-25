export type SessionType = 'practice' | 'tournament';

export interface SeasonSettings {
  credits_per_dollar: number;
  min_credits_to_play: number;
  extra_credit_cap: number | null;
  free_entry: boolean;
  roster_size: number;
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
  decay_grace_weeks: number;
  decay_rate: number;
  decay_floor: number;
  decay_return_window: number;
  usage_reset: 'cycle';
  default_pick: 'best_unused' | 'forfeit';
  trade_review_hours: number;
  trade_keeps_usage: boolean;
  stat_lock_hours: number;
  tap_merge_seconds: number;
}

export const DEFAULT_SETTINGS: SeasonSettings = {
  credits_per_dollar: 20,
  min_credits_to_play: 100,
  extra_credit_cap: null,
  free_entry: false,
  roster_size: 5,
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
  upset_k: 1,
  standings_floor: null,
  decay_mode: 'exponential',
  decay_grace_weeks: 2,
  decay_rate: 0.95,
  decay_floor: 0.5,
  decay_return_window: 4,
  usage_reset: 'cycle',
  default_pick: 'best_unused',
  trade_review_hours: 24,
  trade_keeps_usage: true,
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

const CHECKS: Record<keyof SeasonSettings, Check> = {
  credits_per_dollar: num(1, 10_000, true),
  min_credits_to_play: num(0, 10_000_000, true),
  extra_credit_cap: nullable(num(0, 1_000_000_000, true)),
  free_entry: bool,
  roster_size: num(1, 30, true),
  min_bid: num(0, 10_000_000, true),
  exclusive_ownership: bool,
  allow_self_ownership: bool,
  stat_weights: numberMap,
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
  decay_grace_weeks: num(0, 52, true),
  decay_rate: num(0, 1),
  decay_floor: num(0, 1),
  decay_return_window: num(0, 52, true),
  usage_reset: oneOf('cycle'),
  default_pick: oneOf('best_unused', 'forfeit'),
  trade_review_hours: num(0, 720),
  trade_keeps_usage: bool,
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
  if (issues.length > 0) throw new SettingsError(issues);

  for (const key of Object.keys(merged)) if (!Object.hasOwn(CHECKS, key)) delete merged[key];
  return merged as unknown as SeasonSettings;
}
