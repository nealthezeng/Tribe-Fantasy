# M1 + M2: Foundation and Core Game Logic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed Tribe Fantasy site on GitHub Pages with Supabase login, invite-code league joining and an admin console for seasons, leagues, invites and athletes. It is backed by a fully tested pure-TypeScript game engine (settings, scoring, degradation, rank-weighted points, auction allocation, schedule, picks, week scoring, season simulator).

**Architecture:** A Vite + React + TypeScript SPA with hash routing, deployed to GitHub Pages by GitHub Actions. Supabase Postgres holds all state. Clients may only `select` (as RLS allows), and every write goes through a `security definer` RPC that validates, writes and audit-logs in one transaction. Game rules live in dependency-free `src/core`, so the admin console, the Verify button and the simulator all run identical code.

**Tech Stack:** Node 24, Vite, React 19, react-router 7 (`createHashRouter`), @supabase/supabase-js 2, Vitest, jsdom + @testing-library/react, @electric-sql/pglite (Postgres-in-WASM for DB tests), tsx, ESLint (typescript-eslint).

**Spec:** `docs/superpowers/specs/2026-09-25-tribe-fantasy-design.md`

## Global Constraints

- Site base path: `/Tribe-Fantasy/`; public URL `https://nealthezeng.github.io/Tribe-Fantasy/`. Hash routing only (`/#/admin`).
- `src/core` imports nothing outside `src/core` (no npm packages, no DOM, no Supabase).
- Setting keys are snake_case exactly as in spec §4. Defaults are copied verbatim from spec §4, including `normalize_mode: 'per_point'` and `normalize_per_points: 1`.
- Draft = week 0; the first playing week is week 1.
- Every `public` table has RLS enabled; `anon`/`authenticated` never hold INSERT/UPDATE/DELETE on any `public` table; `anon` cannot execute any `public` function.
- Every RPC raises errors as bare upper-snake codes (`raise exception 'FORBIDDEN'`), and every state change writes `audit_log` via `private.audit`.
- Only the Supabase URL and anon key are ever committed or configured (as GitHub repo *variables*). Never the service-role key or DB password.
- Money is never handled in code (spec §1 non-goal).
- Node is at `C:\Program Files\nodejs` and `gh` at `C:\Program Files\GitHub CLI\gh.exe`. Neither is on the Bash tool's PATH; in PowerShell prefix `$env:Path = "C:\Program Files\nodejs;" + $env:Path;`.

## Review Focus

- **Zero points played / all-negative stats:** a stat line with `pointsPlayed: 0` must give a finite score, using `min_points_denominator`, never NaN or Infinity. Test in Task 3.
- **Messy invite codes:** a code typed as `" abc123 "` must join the league whose code is `ABC123`. Test in Task 12.
- **Every rostered athlete already used after a trade:** the cycle must reset so the manager still has a legal pick; a deadlock is a bug. Test in Task 8.
- **Odd manager counts and seasons longer than one round robin:** everyone gets the same number of byes and the schedule repeats in order. Test in Task 7.
- **Settings typos and partial maps:** `{"decay_rat": 0.9}` must be rejected with a message naming the key; `{"session_multipliers": {"tournament": 3}}` must keep `practice: 1`. Test in Task 2.

---

## File map

```
package.json, tsconfig.json, vite.config.ts, eslint.config.js, index.html, .gitignore
.github/workflows/ci.yml, .github/workflows/deploy.yml
src/main.tsx
src/core/settings.ts        SeasonSettings type, DEFAULT_SETTINGS, parseSettings, SettingsError
src/core/scoring.ts         StatLine, rawScore, athleteWeekScore
src/core/decay.ts           tenureMultiplier, OwnershipRecord, resolveAcquiredWeek
src/core/points.ts          StandingRow, rankSnapshot, matchupDeltas, applyDelta
src/core/rng.ts             hashSeed, mulberry32, seededShuffle
src/core/allocation.ts      Bid, ManagerBudget, Award, allocate, fillLeftovers
src/core/schedule.ts        Pairing, roundRobin
src/core/picks.ts           PickRecord, usedThisCycle, availableAthletes, validatePick, defaultPick
src/core/week.ts            WeekInput, WeekResult, scoreWeek
src/core/simulate.ts        simulateSeason
src/core/index.ts           barrel
scripts/sim.ts              CLI: npm run sim -- <managers> <weeks> <seed>
supabase/migrations/0001_foundation.sql   tables
supabase/migrations/0002_rls.sql          RLS, grants, helper fns
supabase/migrations/0003_foundation_rpcs.sql  RPCs + audit
tests/db/shim.sql           Supabase stand-ins for PGlite
tests/db/helpers.ts         freshDb, createUser, makeAdmin, as, rpc
tests/db/*.test.ts
src/app/App.tsx, src/app/styles.css
src/app/lib/supabase.ts, errors.ts, rpc.ts, codes.ts, useLoad.ts
src/app/auth/AuthProvider.tsx
src/app/components/Layout.tsx
src/app/pages/HomePage.tsx, LoginPage.tsx, JoinPage.tsx, NotConfigured.tsx
src/app/pages/admin/AdminPage.tsx, SeasonsPanel.tsx, SettingsEditor.tsx, LeaguesPanel.tsx, AthletesPanel.tsx
docs/setup-supabase.md
```

Taskboard (`https://claude.ai/artifact/CR4gmKQGgujJfedkLepfso`, collection `tasks`) updates are listed at the end of each task.

---

### Task 1: Scaffold, CI and Pages deploy

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.js`, `index.html`, `.gitignore`, `src/main.tsx`, `src/app/App.tsx` (placeholder), `src/app/App.test.tsx`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: `npm run lint | typecheck | test | build | sim`; the `App` component export from `src/app/App.tsx`.

- [ ] **Step 1: Write config files**

`package.json`:
```json
{
  "name": "tribe-fantasy",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "typecheck": "tsc",
    "lint": "eslint .",
    "test": "vitest run",
    "sim": "tsx scripts/sim.ts"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "tests", "scripts", "vite.config.ts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/Tribe-Fantasy/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
```

`eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tribe Fantasy</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`.gitignore`:
```
node_modules
dist
.env*
!.env.example
graphify-out
```

- [ ] **Step 2: Install dependencies**

```powershell
$env:Path = "C:\Program Files\nodejs;" + $env:Path
npm i react react-dom react-router @supabase/supabase-js
npm i -D vite @vitejs/plugin-react typescript vitest jsdom @testing-library/react @testing-library/dom @electric-sql/pglite tsx eslint @eslint/js typescript-eslint eslint-plugin-react-hooks globals @types/react @types/react-dom @types/node
```

- [ ] **Step 3: Write the failing smoke test**

`src/app/App.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('explains that the database is not connected when no Supabase config is present', () => {
    render(<App />);
    expect(screen.getByText(/not connected to a database yet/i)).toBeTruthy();
  });
});
```

Run: `npx vitest run src/app/App.test.tsx`. Expected: FAIL (cannot resolve `./App`).

- [ ] **Step 4: Minimal app**

`src/app/App.tsx` (placeholder, replaced in Task 13):
```tsx
export function App() {
  return <p>Tribe Fantasy is not connected to a database yet.</p>;
}
```

`src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Run: `npx vitest run`, `npm run lint`, `npm run typecheck`, `npm run build`. Expected: all pass; `dist/index.html` references `/Tribe-Fantasy/assets/...`.

- [ ] **Step 5: CI and deploy workflows**

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
```

`.github/workflows/deploy.yml`:
```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ vars.VITE_SUPABASE_ANON_KEY }}
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 6: Enable Pages, commit, push, verify**

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" api -X POST repos/nealthezeng/Tribe-Fantasy/pages -f build_type=workflow
git add -A; git commit -m "chore: scaffold Vite React TS app with CI and Pages deploy"; git push
& "C:\Program Files\GitHub CLI\gh.exe" run watch --exit-status
```
Expected: both workflows green, and `https://nealthezeng.github.io/Tribe-Fantasy/` shows "not connected to a database yet".

Taskboard: t14 → `doing`, with note "Scaffold + CI + Pages live; Supabase config pending".

---

### Task 2: Season settings

**Files:**
- Create: `src/core/settings.ts`
- Test: `src/core/settings.test.ts`

**Interfaces:**
- Produces:
  - `type SessionType = 'practice' | 'tournament'`
  - `interface SeasonSettings` (spec §4 keys)
  - `DEFAULT_SETTINGS: SeasonSettings`
  - `parseSettings(input: unknown): SeasonSettings`, which throws `SettingsError`
  - `class SettingsError extends Error { issues: string[] }`

- [ ] **Step 1: Write the failing tests**

`src/core/settings.test.ts`:
```ts
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
    expect(DEFAULT_SETTINGS.normalize_mode).toBe('per_point');
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
    expect(() => parseSettings({ stat_weights: { goal: 'x' } })).toThrow(/stat_weights/);
  });

  it('does not share nested objects with DEFAULT_SETTINGS', () => {
    const s = parseSettings({});
    s.stat_weights.goal = 99;
    expect(DEFAULT_SETTINGS.stat_weights.goal).toBe(3);
  });
});
```

Run: `npx vitest run src/core/settings.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

`src/core/settings.ts`:
```ts
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
  stat_weights: { goal: 3, assist: 3, block: 3, callahan: 8, completion: 0.2, throwaway: -2, drop: -2, stall: -2 },
  normalize_mode: 'per_point',
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
    if (!(key in CHECKS)) issues.push(`unknown setting "${key}"`);
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

  for (const key of Object.keys(merged)) if (!(key in CHECKS)) delete merged[key];
  return merged as unknown as SeasonSettings;
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/core/settings.test.ts`. Expected: PASS.

- [ ] **Step 4: Commit**

`git add src/core/settings.* ; git commit -m "feat(core): season settings with defaults and validation"`

---

### Task 3: Athlete week score

**Files:**
- Create: `src/core/scoring.ts`
- Test: `src/core/scoring.test.ts`

**Interfaces:**
- Consumes: `SeasonSettings`, `SessionType`, `parseSettings` (Task 2)
- Produces:
  - `interface StatLine { athleteId: string; sessionType: SessionType; pointsPlayed: number; stats: Record<string, number> }`
  - `rawScore(stats, weights): number`
  - `athleteWeekScore(lines: StatLine[], s: SeasonSettings): number`

- [ ] **Step 1: Write the failing tests**

`src/core/scoring.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { athleteWeekScore, rawScore, type StatLine } from './scoring';

const s = parseSettings({});
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
    expect(rawScore({ completion: 10, throwaway: 1 }, s.stat_weights)).toBeCloseTo(0);
  });
});

describe('athleteWeekScore', () => {
  it('is per point played by default', () => {
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
    expect(athleteWeekScore([line({ pointsPlayed: 0, stats: { throwaway: 4 } })], s)).toBeCloseTo(-8 / 5);
  });

  it('supports raw totals and other scales', () => {
    expect(athleteWeekScore([line()], parseSettings({ normalize_mode: 'none' }))).toBe(9);
    expect(athleteWeekScore([line()], parseSettings({ normalize_per_points: 10 }))).toBeCloseTo(9);
  });

  it('returns absent_score when the athlete has no counted sessions', () => {
    expect(athleteWeekScore([], s)).toBe(0);
    expect(athleteWeekScore([], parseSettings({ absent_score: -1 }))).toBe(-1);
  });
});
```

Run: `npx vitest run src/core/scoring.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement**

`src/core/scoring.ts`:
```ts
import type { SeasonSettings, SessionType } from './settings';

export interface StatLine {
  athleteId: string;
  sessionType: SessionType;
  pointsPlayed: number;
  stats: Record<string, number>;
}

export function rawScore(stats: Record<string, number>, weights: Record<string, number>): number {
  let total = 0;
  for (const [stat, count] of Object.entries(stats)) total += (weights[stat] ?? 0) * count;
  return total;
}

/** Spec §5.1. `lines` must already be one athlete's locked, counted lines for the week. */
export function athleteWeekScore(lines: StatLine[], s: SeasonSettings): number {
  if (lines.length === 0) return s.absent_score;
  let weighted = 0;
  let points = 0;
  for (const l of lines) {
    weighted += (s.session_multipliers[l.sessionType] ?? 1) * rawScore(l.stats, s.stat_weights);
    points += l.pointsPlayed;
  }
  if (s.normalize_mode === 'none') return weighted;
  return (weighted / Math.max(points, s.min_points_denominator)) * s.normalize_per_points;
}
```

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

`git commit -m "feat(core): per-point athlete week score"`

Taskboard: t08 → `done`, with note "Formula v0 implemented in src/core/scoring.ts (settings-driven) instead of a spreadsheet".

---

### Task 4: Degradation (tenure multiplier) and anti-collusion

**Files:**
- Create: `src/core/decay.ts`
- Test: `src/core/decay.test.ts`

**Interfaces:**
- Produces:
  - `tenureMultiplier(week: number, acquiredWeek: number, s: SeasonSettings): number`
  - `interface OwnershipRecord { managerId: string; athleteId: string; acquiredWeek: number; releasedWeek: number | null }`
  - `resolveAcquiredWeek(history: OwnershipRecord[], managerId: string, athleteId: string, currentWeek: number, s: SeasonSettings): number`

- [ ] **Step 1: Write the failing tests**

`src/core/decay.test.ts`:
```ts
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
```

Run: `npx vitest run src/core/decay.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement**

`src/core/decay.ts`:
```ts
import type { SeasonSettings } from './settings';

/** Spec §5.2. */
export function tenureMultiplier(week: number, acquiredWeek: number, s: SeasonSettings): number {
  if (s.decay_mode === 'none') return 1;
  const d = Math.max(0, week - acquiredWeek - s.decay_grace_weeks);
  const m = s.decay_mode === 'exponential' ? s.decay_rate ** d : 1 - (1 - s.decay_rate) * d;
  return Math.max(s.decay_floor, Math.min(1, m));
}

export interface OwnershipRecord {
  managerId: string;
  athleteId: string;
  acquiredWeek: number;
  releasedWeek: number | null;
}

/** Spec §5.4: returning to a recent owner restores that owner's old tenure. */
export function resolveAcquiredWeek(
  history: OwnershipRecord[],
  managerId: string,
  athleteId: string,
  currentWeek: number,
  s: SeasonSettings,
): number {
  let latest: OwnershipRecord | null = null;
  for (const r of history) {
    if (r.managerId !== managerId || r.athleteId !== athleteId || r.releasedWeek === null) continue;
    if (currentWeek - r.releasedWeek > s.decay_return_window) continue;
    if (latest === null || r.releasedWeek > (latest.releasedWeek as number)) latest = r;
  }
  return latest ? latest.acquiredWeek : currentWeek;
}
```

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

`git commit -m "feat(core): tenure degradation multiplier with anti-collusion"`

---

### Task 5: Rank snapshot and rank-weighted points

**Files:**
- Create: `src/core/points.ts`
- Test: `src/core/points.test.ts`

**Interfaces:**
- Produces:
  - `interface StandingRow { managerId: string; points: number; totalScore: number }`
  - `rankSnapshot(rows: StandingRow[]): Record<string, number>`: 1 = best; ties get their average rank.
  - `interface Side { managerId: string; score: number }`
  - `TIE_EPSILON = 0.01`
  - `matchupDeltas(a: Side, b: Side, ranks: Record<string, number>, leagueSize: number, s: SeasonSettings): Record<string, number>`
  - `applyDelta(points: number, delta: number, s: SeasonSettings): number`

- [ ] **Step 1: Write the failing tests**

`src/core/points.test.ts`:
```ts
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
```

Run: `npx vitest run src/core/points.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement**

`src/core/points.ts`:
```ts
import type { SeasonSettings } from './settings';

export interface StandingRow {
  managerId: string;
  points: number;
  totalScore: number;
}

export interface Side {
  managerId: string;
  score: number;
}

export const TIE_EPSILON = 0.01;

/** 1 = best. Managers equal on (points, totalScore) share their average rank. */
export function rankSnapshot(rows: StandingRow[]): Record<string, number> {
  const sorted = [...rows].sort((a, b) => b.points - a.points || b.totalScore - a.totalScore);
  const ranks: Record<string, number> = {};
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (
      j + 1 < sorted.length &&
      sorted[j + 1].points === sorted[i].points &&
      sorted[j + 1].totalScore === sorted[i].totalScore
    ) j++;
    const avg = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k++) ranks[sorted[k].managerId] = avg;
    i = j + 1;
  }
  return ranks;
}

/** Spec §5.3. */
export function matchupDeltas(
  a: Side,
  b: Side,
  ranks: Record<string, number>,
  leagueSize: number,
  s: SeasonSettings,
): Record<string, number> {
  if (Math.abs(a.score - b.score) < TIE_EPSILON) {
    return { [a.managerId]: s.tie_points, [b.managerId]: s.tie_points };
  }
  const [winner, loser] = a.score > b.score ? [a, b] : [b, a];
  let factor = 1;
  if (s.points_mode === 'rank_weighted' && leagueSize >= 2) {
    const middle = (leagueSize + 1) / 2;
    const u = ((ranks[winner.managerId] ?? middle) - (ranks[loser.managerId] ?? middle)) / (leagueSize - 1);
    factor = Math.max(0, 1 + s.upset_k * u);
  }
  return {
    [winner.managerId]: s.win_points * factor,
    [loser.managerId]: 0 - s.loss_points * factor,
  };
}

export function applyDelta(points: number, delta: number, s: SeasonSettings): number {
  const next = points + delta;
  return s.standings_floor === null ? next : Math.max(s.standings_floor, next);
}
```

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

`git commit -m "feat(core): rank snapshot and rank-weighted matchup points"`

Taskboard: t10 → `doing`, with note "Rank-weighted (underdog bonus) implemented; exact curve (upset_k, base points) still to tune".

---

### Task 6: Seeded RNG and auction allocation

**Files:**
- Create: `src/core/rng.ts`, `src/core/allocation.ts`
- Test: `src/core/rng.test.ts`, `src/core/allocation.test.ts`

**Interfaces:**
- Produces:
  - `hashSeed(text: string): number`
  - `mulberry32(seed: number): () => number`, returning values in [0, 1)
  - `seededShuffle<T>(items: readonly T[], seed: string): T[]`
  - `interface Bid { id: string; managerId: string; athleteId: string; amount: number; placedAt: string /* ISO */ }`
  - `interface ManagerBudget { managerId: string; budget: number; openSlots: number }`
  - `interface Award { managerId: string; athleteId: string; amount: number; bidId: string | null }`
  - `interface AllocationResult { awards: Award[]; remaining: ManagerBudget[]; unclaimed: string[] }`
  - `compareBids(a: Bid, b: Bid): number`
  - `allocate(bids: Bid[], managers: ManagerBudget[], athleteIds: string[]): AllocationResult`
  - `fillLeftovers(managers: ManagerBudget[], unclaimed: string[], seed: string): Award[]`

- [ ] **Step 1: Write the failing RNG tests**

`src/core/rng.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, seededShuffle } from './rng';

describe('rng', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = mulberry32(hashSeed('x'));
    const b = mulberry32(hashSeed('x'));
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('shuffles deterministically without losing items or mutating input', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const s1 = seededShuffle(items, 'seed');
    expect(seededShuffle(items, 'seed')).toEqual(s1);
    expect([...s1].sort()).toEqual(items);
    expect(items).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(seededShuffle(items, 'other')).not.toEqual(s1);
  });
});
```

- [ ] **Step 2: Implement `src/core/rng.ts`**

```ts
/** FNV-1a 32-bit hash of a string. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rand = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
```

Run: `npx vitest run src/core/rng.test.ts`. Expected: PASS.

- [ ] **Step 3: Write the failing allocation tests**

`src/core/allocation.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { allocate, fillLeftovers, type Bid, type ManagerBudget } from './allocation';
import { hashSeed, mulberry32, seededShuffle } from './rng';

const t = (s: number) => new Date(Date.UTC(2027, 0, 25, 0, 0, s)).toISOString();
const bid = (id: string, managerId: string, athleteId: string, amount: number, sec = 0): Bid => ({
  id, managerId, athleteId, amount, placedAt: t(sec),
});
const mgr = (managerId: string, budget = 100, openSlots = 2): ManagerBudget => ({ managerId, budget, openSlots });

describe('allocate', () => {
  it('gives each athlete to the highest bidder', () => {
    const r = allocate([bid('b1', 'm1', 'a1', 10), bid('b2', 'm2', 'a1', 20)], [mgr('m1'), mgr('m2')], ['a1']);
    expect(r.awards).toEqual([{ managerId: 'm2', athleteId: 'a1', amount: 20, bidId: 'b2' }]);
    expect(r.remaining.find((m) => m.managerId === 'm2')).toEqual({ managerId: 'm2', budget: 80, openSlots: 1 });
  });

  it('breaks equal bids by earliest placedAt, then bid id', () => {
    const early = allocate([bid('b1', 'm1', 'a1', 10, 5), bid('b2', 'm2', 'a1', 10, 1)], [mgr('m1'), mgr('m2')], ['a1']);
    expect(early.awards[0].managerId).toBe('m2');
    const same = allocate([bid('b9', 'm1', 'a1', 10), bid('b3', 'm2', 'a1', 10)], [mgr('m1'), mgr('m2')], ['a1']);
    expect(same.awards[0].bidId).toBe('b3');
  });

  it('falls to the next bidder when the winner is out of budget or roster room', () => {
    const r = allocate(
      [bid('b1', 'm1', 'a1', 60), bid('b2', 'm1', 'a2', 50), bid('b3', 'm2', 'a2', 5)],
      [mgr('m1', 100), mgr('m2')],
      ['a1', 'a2'],
    );
    expect(r.awards.map((a) => [a.athleteId, a.managerId])).toEqual([['a1', 'm1'], ['a2', 'm2']]);
    const full = allocate(
      [bid('b1', 'm1', 'a1', 9), bid('b2', 'm1', 'a2', 8), bid('b3', 'm2', 'a2', 1)],
      [mgr('m1', 100, 1), mgr('m2')],
      ['a1', 'a2'],
    );
    expect(full.awards.map((a) => [a.athleteId, a.managerId])).toEqual([['a1', 'm1'], ['a2', 'm2']]);
  });

  it('ignores bids on unavailable athletes and from unknown managers, and reports unclaimed', () => {
    const r = allocate([bid('b1', 'm1', 'gone', 50), bid('b2', 'ghost', 'a1', 50)], [mgr('m1')], ['a1', 'a2']);
    expect(r.awards).toEqual([]);
    expect(r.unclaimed).toEqual(['a1', 'a2']);
  });

  it('holds invariants and is order-independent across random drafts', () => {
    for (let trial = 0; trial < 500; trial++) {
      const rand = mulberry32(hashSeed(`trial-${trial}`));
      const nM = 2 + Math.floor(rand() * 6);
      const nA = 5 + Math.floor(rand() * 25);
      const managers = Array.from({ length: nM }, (_, i) => mgr(`m${i}`, Math.floor(rand() * 200), 1 + Math.floor(rand() * 5)));
      const athletes = Array.from({ length: nA }, (_, i) => `a${i}`);
      const bids: Bid[] = [];
      for (const m of managers) for (const a of athletes) {
        if (rand() < 0.4) bids.push(bid(`${m.managerId}-${a}`, m.managerId, a, 1 + Math.floor(rand() * 60), Math.floor(rand() * 50)));
      }
      const r = allocate(bids, managers, athletes);

      const owners = new Set<string>();
      for (const aw of r.awards) {
        expect(owners.has(aw.athleteId)).toBe(false);
        owners.add(aw.athleteId);
        const b = bids.find((x) => x.id === aw.bidId)!;
        expect([b.managerId, b.athleteId, b.amount]).toEqual([aw.managerId, aw.athleteId, aw.amount]);
      }
      for (const m of managers) {
        const mine = r.awards.filter((a) => a.managerId === m.managerId);
        const spent = mine.reduce((sum, a) => sum + a.amount, 0);
        expect(mine.length).toBeLessThanOrEqual(m.openSlots);
        expect(spent).toBeLessThanOrEqual(m.budget);
        expect(r.remaining.find((x) => x.managerId === m.managerId)).toEqual({
          managerId: m.managerId, budget: m.budget - spent, openSlots: m.openSlots - mine.length,
        });
      }
      expect(allocate(seededShuffle(bids, `s${trial}`), managers, athletes)).toEqual(r);
    }
  });
});

describe('fillLeftovers', () => {
  it('deals unclaimed athletes round-robin into open slots, deterministically, at 0 credits', () => {
    const managers = [mgr('m1', 0, 2), mgr('m2', 0, 1), mgr('m3', 0, 0)];
    const awards = fillLeftovers(managers, ['a1', 'a2', 'a3', 'a4'], 'seed');
    expect(awards).toHaveLength(3);
    expect(awards.filter((a) => a.managerId === 'm1')).toHaveLength(2);
    expect(awards.filter((a) => a.managerId === 'm3')).toHaveLength(0);
    expect(awards.every((a) => a.amount === 0 && a.bidId === null)).toBe(true);
    expect(new Set(awards.map((a) => a.athleteId)).size).toBe(3);
    expect(fillLeftovers([...managers].reverse(), ['a4', 'a3', 'a2', 'a1'], 'seed')).toEqual(awards);
  });
});
```

Run: `npx vitest run src/core/allocation.test.ts`. Expected: FAIL.

- [ ] **Step 4: Implement `src/core/allocation.ts`**

```ts
import { seededShuffle } from './rng';

export interface Bid {
  id: string;
  managerId: string;
  athleteId: string;
  amount: number;
  placedAt: string;
}

export interface ManagerBudget {
  managerId: string;
  budget: number;
  openSlots: number;
}

export interface Award {
  managerId: string;
  athleteId: string;
  amount: number;
  bidId: string | null;
}

export interface AllocationResult {
  awards: Award[];
  remaining: ManagerBudget[];
  unclaimed: string[];
}

const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function compareBids(a: Bid, b: Bid): number {
  return b.amount - a.amount || Date.parse(a.placedAt) - Date.parse(b.placedAt) || byString(a.id, b.id);
}

/** Spec §5.5: highest bid first; skip if taken, roster full or unaffordable. */
export function allocate(bids: Bid[], managers: ManagerBudget[], athleteIds: string[]): AllocationResult {
  const state = new Map(managers.map((m) => [m.managerId, { ...m }]));
  const open = new Set(athleteIds);
  const awards: Award[] = [];
  for (const b of [...bids].sort(compareBids)) {
    const m = state.get(b.managerId);
    if (!m || !open.has(b.athleteId) || m.openSlots <= 0 || m.budget < b.amount) continue;
    open.delete(b.athleteId);
    m.budget -= b.amount;
    m.openSlots -= 1;
    awards.push({ managerId: m.managerId, athleteId: b.athleteId, amount: b.amount, bidId: b.id });
  }
  return {
    awards,
    remaining: managers.map((m) => ({ ...state.get(m.managerId)! })),
    unclaimed: athleteIds.filter((a) => open.has(a)),
  };
}

/** Spec §5.5 final fill: seeded shuffle, dealt one per manager per pass, 0 credits. */
export function fillLeftovers(managers: ManagerBudget[], unclaimed: string[], seed: string): Award[] {
  const pool = seededShuffle([...unclaimed].sort(byString), `${seed}:athletes`);
  const order = seededShuffle(
    [...managers].sort((a, b) => byString(a.managerId, b.managerId)).map((m) => ({ ...m })),
    `${seed}:managers`,
  );
  const awards: Award[] = [];
  let progressed = true;
  while (pool.length > 0 && progressed) {
    progressed = false;
    for (const m of order) {
      if (pool.length === 0) break;
      if (m.openSlots <= 0) continue;
      awards.push({ managerId: m.managerId, athleteId: pool.shift()!, amount: 0, bidId: null });
      m.openSlots -= 1;
      progressed = true;
    }
  }
  return awards;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/core/rng.test.ts src/core/allocation.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit**

`git commit -m "feat(core): deterministic auction allocation and seeded leftover fill"`

Taskboard: t12 → `done` (note: "Sealed bids, highest-first, earliest-then-id tiebreak, leftover sealed round + seeded fill"). t33 → `done` (note: "Logic + 500-draft property test in src/core; DB/UI wiring in M5").

---

### Task 7: Round-robin schedule

**Files:**
- Create: `src/core/schedule.ts`
- Test: `src/core/schedule.test.ts`

**Interfaces:**
- Produces:
  - `type Pairing = [string, string | null]` (null = bye)
  - `roundRobin(managerIds: string[], weeks: number): Pairing[][]`: index 0 = week 1.

- [ ] **Step 1: Write the failing tests**

`src/core/schedule.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { roundRobin } from './schedule';

const key = (a: string, b: string) => [a, b].sort().join('-');

describe('roundRobin', () => {
  it('pairs every manager with every other exactly once per round (even count)', () => {
    const weeks = roundRobin(['d', 'c', 'b', 'a'], 3);
    const seen = new Set<string>();
    for (const week of weeks) {
      expect(week.flat().sort()).toEqual(['a', 'b', 'c', 'd']);
      for (const [x, y] of week) seen.add(key(x, y!));
    }
    expect(seen.size).toBe(6);
  });

  it('gives each manager exactly one bye per round (odd count)', () => {
    const weeks = roundRobin(['a', 'b', 'c', 'd', 'e'], 5);
    const byes: Record<string, number> = {};
    const pairs = new Set<string>();
    for (const week of weeks) {
      for (const [x, y] of week) {
        if (y === null) byes[x] = (byes[x] ?? 0) + 1;
        else pairs.add(key(x, y));
      }
    }
    expect(byes).toEqual({ a: 1, b: 1, c: 1, d: 1, e: 1 });
    expect(pairs.size).toBe(10);
  });

  it('repeats rounds in order when the season is longer than one round robin', () => {
    const weeks = roundRobin(['a', 'b', 'c', 'd'], 7);
    expect(weeks).toHaveLength(7);
    expect(weeks[3]).toEqual(weeks[0]);
    expect(weeks[6]).toEqual(weeks[0]);
  });

  it('handles tiny leagues', () => {
    expect(roundRobin(['a'], 2)).toEqual([[['a', null]], [['a', null]]]);
    expect(roundRobin([], 2)).toEqual([[], []]);
  });
});
```

Run: `npx vitest run src/core/schedule.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `src/core/schedule.ts`**

```ts
export type Pairing = [string, string | null];

/** Circle method. Deterministic: managers are sorted first. */
export function roundRobin(managerIds: string[], weeks: number): Pairing[][] {
  const ids = [...managerIds].sort();
  if (ids.length < 2) {
    return Array.from({ length: weeks }, () => ids.map((id): Pairing => [id, null]));
  }
  const slots: (string | null)[] = ids.length % 2 === 1 ? [...ids, null] : [...ids];
  const n = slots.length;
  const rounds: Pairing[][] = [];
  let rest = slots.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const circle = [slots[0], ...rest];
    const round: Pairing[] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = circle[i];
      const b = circle[n - 1 - i];
      round.push(a === null ? [b as string, null] : [a, b]);
    }
    rounds.push(round);
    rest = [rest[rest.length - 1], ...rest.slice(0, -1)];
  }
  return Array.from({ length: weeks }, (_, w) => rounds[w % rounds.length].map((p): Pairing => [p[0], p[1]]));
}
```

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

`git commit -m "feat(core): round-robin schedule with byes"`

Taskboard: t37 → `done` (note: "Logic in src/core/schedule.ts; persisted by admin in M6").

---

### Task 8: Weekly picks (no-repeat cycle, default pick)

**Files:**
- Create: `src/core/picks.ts`
- Test: `src/core/picks.test.ts`

**Interfaces:**
- Produces:
  - `interface PickRecord { week: number; managerId: string; athleteId: string }`
  - `usedThisCycle(managerId: string, roster: string[], picks: PickRecord[], beforeWeek: number, s: SeasonSettings): Set<string>`
  - `availableAthletes(roster: string[], used: Set<string>): string[]`
  - `validatePick(athleteId: string, roster: string[], used: Set<string>): 'NOT_ON_ROSTER' | 'ATHLETE_ALREADY_USED' | null`
  - `defaultPick(available: string[], history: Record<string, number[]>, s: SeasonSettings): string | null`

- [ ] **Step 1: Write the failing tests**

`src/core/picks.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { availableAthletes, defaultPick, usedThisCycle, validatePick, type PickRecord } from './picks';

const s = parseSettings({});
const p = (week: number, managerId: string, athleteId: string): PickRecord => ({ week, managerId, athleteId });

describe('usedThisCycle', () => {
  const roster = ['a1', 'a2', 'a3'];

  it('tracks athletes used so far this cycle, only counting weeks before the current one', () => {
    const picks = [p(1, 'm1', 'a1'), p(2, 'm1', 'a2'), p(3, 'm1', 'a3')];
    expect([...usedThisCycle('m1', roster, picks, 3, s)].sort()).toEqual(['a1', 'a2']);
  });

  it('resets once every rostered athlete has been used', () => {
    const picks = [p(1, 'm1', 'a1'), p(2, 'm1', 'a2'), p(3, 'm1', 'a3'), p(4, 'm1', 'a2')];
    expect([...usedThisCycle('m1', roster, picks, 4, s)]).toEqual([]);
    expect([...usedThisCycle('m1', roster, picks, 5, s)]).toEqual(['a2']);
  });

  it('counts a traded-in athlete the previous owner used this cycle (trade_keeps_usage)', () => {
    const picks = [p(1, 'm1', 'a1'), p(1, 'm2', 'a3')];
    expect([...usedThisCycle('m1', roster, picks, 2, s)].sort()).toEqual(['a1', 'a3']);
    const off = parseSettings({ trade_keeps_usage: false });
    expect([...usedThisCycle('m1', roster, picks, 2, off)]).toEqual(['a1']);
  });

  it('resets instead of deadlocking when trades leave every rostered athlete used', () => {
    const picks = [p(1, 'm1', 'a1'), p(1, 'm2', 'a2'), p(1, 'm3', 'a3')];
    const used = usedThisCycle('m1', roster, picks, 2, s);
    expect(availableAthletes(roster, used)).toEqual(roster);
  });

  it('ignores used athletes who are no longer on the roster', () => {
    const picks = [p(1, 'm1', 'gone')];
    expect([...usedThisCycle('m1', roster, picks, 2, s)]).toEqual([]);
  });
});

describe('validatePick', () => {
  it('rejects athletes not on the roster or already used', () => {
    const used = new Set(['a1']);
    expect(validatePick('zz', ['a1', 'a2'], used)).toBe('NOT_ON_ROSTER');
    expect(validatePick('a1', ['a1', 'a2'], used)).toBe('ATHLETE_ALREADY_USED');
    expect(validatePick('a2', ['a1', 'a2'], used)).toBeNull();
  });
});

describe('defaultPick', () => {
  it('picks the best 3-week average, ties to the lowest id', () => {
    const history = { a1: [1, 1, 1], a2: [0, 9, 3, 3], a3: [3, 3, 3] };
    expect(defaultPick(['a1', 'a2', 'a3'], history, s)).toBe('a2');
    expect(defaultPick(['a3', 'a1'], { a1: [3], a3: [3] }, s)).toBe('a1');
    expect(defaultPick(['a2', 'a1'], {}, s)).toBe('a1');
  });
  it('forfeits when configured or when nothing is available', () => {
    expect(defaultPick(['a1'], {}, parseSettings({ default_pick: 'forfeit' }))).toBeNull();
    expect(defaultPick([], {}, s)).toBeNull();
  });
});
```

Run: `npx vitest run src/core/picks.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `src/core/picks.ts`**

```ts
import type { SeasonSettings } from './settings';

export interface PickRecord {
  week: number;
  managerId: string;
  athleteId: string;
}

const coversRoster = (roster: string[], used: Set<string>) =>
  roster.length > 0 && roster.every((a) => used.has(a));

/**
 * Spec §5.7. Athletes on `roster` that the manager may not pick in week `beforeWeek`.
 * A cycle ends when every current rostered athlete has been used.
 */
export function usedThisCycle(
  managerId: string,
  roster: string[],
  picks: PickRecord[],
  beforeWeek: number,
  s: SeasonSettings,
): Set<string> {
  const past = picks.filter((p) => p.week < beforeWeek).sort((a, b) => a.week - b.week);
  let used = new Set<string>();
  let cycleStart = 0;
  for (const p of past) {
    if (p.managerId !== managerId) continue;
    used.add(p.athleteId);
    if (coversRoster(roster, used)) {
      used = new Set();
      cycleStart = p.week + 1;
    }
  }
  if (s.trade_keeps_usage && s.exclusive_ownership) {
    const rosterSet = new Set(roster);
    for (const p of past) {
      if (p.managerId !== managerId && p.week >= cycleStart && rosterSet.has(p.athleteId)) used.add(p.athleteId);
    }
    if (coversRoster(roster, used)) used = new Set();
  }
  return new Set(roster.filter((a) => used.has(a)));
}

export function availableAthletes(roster: string[], used: Set<string>): string[] {
  return roster.filter((a) => !used.has(a));
}

export function validatePick(
  athleteId: string,
  roster: string[],
  used: Set<string>,
): 'NOT_ON_ROSTER' | 'ATHLETE_ALREADY_USED' | null {
  if (!roster.includes(athleteId)) return 'NOT_ON_ROSTER';
  if (used.has(athleteId)) return 'ATHLETE_ALREADY_USED';
  return null;
}

/** `history`: each athlete's week scores in chronological order. */
export function defaultPick(
  available: string[],
  history: Record<string, number[]>,
  s: SeasonSettings,
): string | null {
  if (s.default_pick === 'forfeit' || available.length === 0) return null;
  const avg = (id: string) => {
    const recent = (history[id] ?? []).slice(-3);
    return recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  };
  return [...available].sort((a, b) => avg(b) - avg(a) || (a < b ? -1 : a > b ? 1 : 0))[0];
}
```

- [ ] **Step 3: Run tests**

Expected: PASS.

- [ ] **Step 4: Commit**

`git commit -m "feat(core): weekly pick rules with no-repeat cycles and default pick"`

Taskboard: t11 → `done` (note: "Usage resets each cycle; traded athletes keep usage; absent = absent_score").

---

### Task 9: Week scoring

**Files:**
- Create: `src/core/week.ts`, `src/core/index.ts`
- Test: `src/core/week.test.ts`

**Interfaces:**
- Consumes: `athleteWeekScore`, `StatLine` (Task 3); `tenureMultiplier` (Task 4); `rankSnapshot`, `matchupDeltas`, `applyDelta`, `StandingRow` (Task 5)
- Produces:
  - `interface WeekMatchup { id: string; home: string; away: string | null }`
  - `interface WeekInput { week: number; settings: SeasonSettings; matchups: WeekMatchup[]; picks: Record<string, string | null>; statLines: StatLine[]; acquiredWeek: Record<string, number>; standings: StandingRow[] }`. `acquiredWeek` is keyed by `` `${managerId}:${athleteId}` ``, and `standings` must list every manager in the league.
  - `interface SideResult { managerId: string; athleteId: string | null; athleteScore: number; multiplier: number; score: number; delta: number }`
  - `interface MatchupResult { id: string; home: SideResult; away: SideResult | null }`
  - `interface WeekResult { ranks: Record<string, number>; athleteScores: Record<string, number>; matchups: MatchupResult[]; standings: StandingRow[] }`
  - `scoreWeek(input: WeekInput): WeekResult`
  - `acquiredKey(managerId: string, athleteId: string): string`

- [ ] **Step 1: Write the failing tests**

`src/core/week.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { acquiredKey, scoreWeek, type WeekInput } from './week';

const s = parseSettings({ points_mode: 'fixed' });
const base = (over: Partial<WeekInput> = {}): WeekInput => ({
  week: 1,
  settings: s,
  matchups: [{ id: 'x1', home: 'm1', away: 'm2' }, { id: 'x2', home: 'm3', away: null }],
  picks: { m1: 'a1', m2: 'a2', m3: 'a3' },
  statLines: [
    { athleteId: 'a1', sessionType: 'practice', pointsPlayed: 10, stats: { goal: 4 } },
    { athleteId: 'a2', sessionType: 'practice', pointsPlayed: 10, stats: { goal: 1 } },
  ],
  acquiredWeek: {},
  standings: ['m1', 'm2', 'm3'].map((managerId) => ({ managerId, points: 0, totalScore: 0 })),
  ...over,
});

describe('scoreWeek', () => {
  it('scores each side, decides the matchup and updates standings', () => {
    const r = scoreWeek(base());
    expect(r.athleteScores.a1).toBeCloseTo(1.2);
    expect(r.matchups[0].home).toMatchObject({ managerId: 'm1', athleteId: 'a1', multiplier: 1, delta: 3 });
    expect(r.matchups[0].away).toMatchObject({ managerId: 'm2', delta: -1 });
    expect(r.matchups[1].away).toBeNull();
    const pts = Object.fromEntries(r.standings.map((row) => [row.managerId, row.points]));
    expect(pts).toEqual({ m1: 3, m2: -1, m3: 0 });
    expect(r.standings.find((row) => row.managerId === 'm1')!.totalScore).toBeCloseTo(1.2);
  });

  it('applies the tenure multiplier from acquiredWeek', () => {
    const r = scoreWeek(base({ week: 4, acquiredWeek: { [acquiredKey('m1', 'a1')]: 0 } }));
    expect(r.matchups[0].home.multiplier).toBeCloseTo(0.9025);
    expect(r.matchups[0].home.score).toBeCloseTo(1.2 * 0.9025);
  });

  it('treats a forfeited pick as a score of 0', () => {
    const r = scoreWeek(base({ picks: { m1: null, m2: 'a2', m3: 'a3' } }));
    expect(r.matchups[0].home).toMatchObject({ athleteId: null, score: 0, delta: -1 });
    expect(r.matchups[0].away!.delta).toBe(3);
  });

  it('uses the standings before the week for rank weighting', () => {
    const r = scoreWeek(base({
      settings: parseSettings({}),
      standings: [
        { managerId: 'm1', points: 0, totalScore: 0 },
        { managerId: 'm2', points: 9, totalScore: 9 },
        { managerId: 'm3', points: 3, totalScore: 3 },
      ],
    }));
    expect(r.ranks).toEqual({ m2: 1, m3: 2, m1: 3 });
    expect(r.matchups[0].home.delta).toBeCloseTo(6);
  });
});
```

Run: `npx vitest run src/core/week.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `src/core/week.ts`**

```ts
import { tenureMultiplier } from './decay';
import { applyDelta, matchupDeltas, rankSnapshot, type StandingRow } from './points';
import { athleteWeekScore, type StatLine } from './scoring';
import type { SeasonSettings } from './settings';

export interface WeekMatchup {
  id: string;
  home: string;
  away: string | null;
}

export interface WeekInput {
  week: number;
  settings: SeasonSettings;
  matchups: WeekMatchup[];
  picks: Record<string, string | null>;
  statLines: StatLine[];
  acquiredWeek: Record<string, number>;
  standings: StandingRow[];
}

export interface SideResult {
  managerId: string;
  athleteId: string | null;
  athleteScore: number;
  multiplier: number;
  score: number;
  delta: number;
}

export interface MatchupResult {
  id: string;
  home: SideResult;
  away: SideResult | null;
}

export interface WeekResult {
  ranks: Record<string, number>;
  athleteScores: Record<string, number>;
  matchups: MatchupResult[];
  standings: StandingRow[];
}

export const acquiredKey = (managerId: string, athleteId: string) => `${managerId}:${athleteId}`;

export function scoreWeek(input: WeekInput): WeekResult {
  const s = input.settings;
  const linesByAthlete = new Map<string, StatLine[]>();
  for (const l of input.statLines) {
    const list = linesByAthlete.get(l.athleteId) ?? [];
    list.push(l);
    linesByAthlete.set(l.athleteId, list);
  }
  const athleteScores: Record<string, number> = {};
  const scoreOf = (id: string) => (athleteScores[id] ??= athleteWeekScore(linesByAthlete.get(id) ?? [], s));

  const side = (managerId: string): SideResult => {
    const athleteId = input.picks[managerId] ?? null;
    if (athleteId === null) return { managerId, athleteId, athleteScore: 0, multiplier: 0, score: 0, delta: 0 };
    const athleteScore = scoreOf(athleteId);
    const acquired = input.acquiredWeek[acquiredKey(managerId, athleteId)] ?? input.week;
    const multiplier = tenureMultiplier(input.week, acquired, s);
    return { managerId, athleteId, athleteScore, multiplier, score: athleteScore * multiplier, delta: 0 };
  };

  const ranks = rankSnapshot(input.standings);
  const matchups: MatchupResult[] = input.matchups.map((m) => {
    const home = side(m.home);
    if (m.away === null) return { id: m.id, home, away: null };
    const away = side(m.away);
    const d = matchupDeltas(home, away, ranks, input.standings.length, s);
    home.delta = d[home.managerId];
    away.delta = d[away.managerId];
    return { id: m.id, home, away };
  });

  const bySide = new Map<string, SideResult>();
  for (const m of matchups) {
    bySide.set(m.home.managerId, m.home);
    if (m.away) bySide.set(m.away.managerId, m.away);
  }
  const standings = input.standings.map((row) => {
    const sr = bySide.get(row.managerId);
    return sr
      ? { managerId: row.managerId, points: applyDelta(row.points, sr.delta, s), totalScore: row.totalScore + sr.score }
      : { ...row };
  });

  return { ranks, athleteScores, matchups, standings };
}
```

`src/core/index.ts`:
```ts
export * from './settings';
export * from './scoring';
export * from './decay';
export * from './points';
export * from './rng';
export * from './allocation';
export * from './schedule';
export * from './picks';
export * from './week';
```

- [ ] **Step 3: Run all core tests**

Run: `npx vitest run src/core`. Expected: PASS.

- [ ] **Step 4: Commit**

`git commit -m "feat(core): week scoring orchestrator"`

Taskboard: t39 → `doing` (note: "Scoring logic done in src/core/week.ts; DB job + UI in M6").

---

### Task 10: Season simulator and CLI

**Files:**
- Create: `src/core/simulate.ts`, `scripts/sim.ts`
- Modify: `src/core/index.ts` (add `export * from './simulate';`)
- Test: `src/core/simulate.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–9.
- Produces:
  - `interface SimConfig { managers: number; athletes: number; weeks: number; seed: string; settings?: unknown; tournamentWeeks?: number[] }`
  - `interface SimResult { settings: SeasonSettings; rosters: Record<string, string[]>; picks: PickRecord[]; weeks: WeekResult[]; standings: StandingRow[] }`
  - `simulateSeason(cfg: SimConfig): SimResult`

- [ ] **Step 1: Write the failing tests**

`src/core/simulate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { simulateSeason } from './simulate';

describe('simulateSeason', () => {
  const r = simulateSeason({ managers: 6, athletes: 30, weeks: 10, seed: 'test', tournamentWeeks: [4, 8] });

  it('drafts full, exclusive rosters', () => {
    const all = Object.values(r.rosters).flat();
    expect(Object.values(r.rosters).every((roster) => roster.length === 5)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it('never repeats an athlete within a cycle', () => {
    for (const managerId of Object.keys(r.rosters)) {
      const mine = r.picks.filter((p) => p.managerId === managerId).sort((a, b) => a.week - b.week);
      expect(mine).toHaveLength(10);
      expect(new Set(mine.slice(0, 5).map((p) => p.athleteId)).size).toBe(5);
      expect(new Set(mine.slice(5, 10).map((p) => p.athleteId)).size).toBe(5);
    }
  });

  it('keeps standings equal to the sum of weekly deltas', () => {
    for (const row of r.standings) {
      const sum = r.weeks.flatMap((w) => w.matchups)
        .flatMap((m) => [m.home, m.away])
        .filter((side) => side?.managerId === row.managerId)
        .reduce((acc, side) => acc + side!.delta, 0);
      expect(row.points).toBeCloseTo(sum);
    }
  });

  it('is deterministic per seed', () => {
    expect(simulateSeason({ managers: 6, athletes: 30, weeks: 10, seed: 'test', tournamentWeeks: [4, 8] })).toEqual(r);
  });

  it('copes with more roster capacity than athletes and an odd manager count', () => {
    const odd = simulateSeason({ managers: 7, athletes: 30, weeks: 6, seed: 'odd' });
    expect(Object.values(odd.rosters).flat()).toHaveLength(30);
    expect(odd.weeks).toHaveLength(6);
  });
});
```

Run: `npx vitest run src/core/simulate.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement `src/core/simulate.ts`**

```ts
import { allocate, fillLeftovers, type Bid, type ManagerBudget } from './allocation';
import { availableAthletes, defaultPick, usedThisCycle, type PickRecord } from './picks';
import type { StandingRow } from './points';
import { hashSeed, mulberry32 } from './rng';
import { roundRobin } from './schedule';
import type { StatLine } from './scoring';
import { parseSettings, type SeasonSettings } from './settings';
import { acquiredKey, scoreWeek, type WeekResult } from './week';

export interface SimConfig {
  managers: number;
  athletes: number;
  weeks: number;
  seed: string;
  settings?: unknown;
  tournamentWeeks?: number[];
}

export interface SimResult {
  settings: SeasonSettings;
  rosters: Record<string, string[]>;
  picks: PickRecord[];
  weeks: WeekResult[];
  standings: StandingRow[];
}

const pad = (i: number) => String(i).padStart(2, '0');

/** Plays a fake season with the real rules. Used for tests and for tuning settings. */
export function simulateSeason(cfg: SimConfig): SimResult {
  const s = parseSettings(cfg.settings ?? {});
  const rand = mulberry32(hashSeed(cfg.seed));
  const managerIds = Array.from({ length: cfg.managers }, (_, i) => `m${pad(i)}`);
  const athleteIds = Array.from({ length: cfg.athletes }, (_, i) => `a${pad(i)}`);
  const skill = Object.fromEntries(athleteIds.map((a) => [a, 0.5 + rand()]));

  const budgets: ManagerBudget[] = managerIds.map((managerId) => ({
    managerId,
    budget: s.min_credits_to_play + Math.floor(rand() * 200),
    openSlots: s.roster_size,
  }));
  const bids: Bid[] = [];
  for (const m of budgets) {
    for (const a of athleteIds) {
      if (rand() < 0.3) {
        bids.push({
          id: `${m.managerId}-${a}`,
          managerId: m.managerId,
          athleteId: a,
          amount: 1 + Math.floor(rand() * (m.budget / s.roster_size) * 1.5),
          placedAt: new Date(Date.UTC(2027, 0, 25, 0, 0, Math.floor(rand() * 3600))).toISOString(),
        });
      }
    }
  }
  const round1 = allocate(bids, budgets, athleteIds);
  const filled = fillLeftovers(round1.remaining, round1.unclaimed, cfg.seed);
  const rosters: Record<string, string[]> = Object.fromEntries(managerIds.map((m) => [m, [] as string[]]));
  const acquiredWeek: Record<string, number> = {};
  for (const aw of [...round1.awards, ...filled]) {
    rosters[aw.managerId].push(aw.athleteId);
    acquiredWeek[acquiredKey(aw.managerId, aw.athleteId)] = 0;
  }
  for (const m of managerIds) rosters[m].sort();

  const schedule = roundRobin(managerIds, cfg.weeks);
  let standings: StandingRow[] = managerIds.map((managerId) => ({ managerId, points: 0, totalScore: 0 }));
  const picks: PickRecord[] = [];
  const history: Record<string, number[]> = {};
  const weeks: WeekResult[] = [];

  for (let week = 1; week <= cfg.weeks; week++) {
    const sessionType = cfg.tournamentWeeks?.includes(week) ? 'tournament' : 'practice';
    const statLines: StatLine[] = athleteIds.map((a) => {
      const k = skill[a];
      return {
        athleteId: a,
        sessionType,
        pointsPlayed: 5 + Math.floor(rand() * 15),
        stats: {
          goal: Math.floor(rand() * 3 * k),
          assist: Math.floor(rand() * 3 * k),
          block: Math.floor(rand() * 2 * k),
          completion: Math.floor(rand() * 20 * k),
          throwaway: Math.floor(rand() * 3 * (1.5 - k / 1.5)),
        },
      };
    });

    const weekPicks: Record<string, string | null> = {};
    for (const m of managerIds) {
      const used = usedThisCycle(m, rosters[m], picks, week, s);
      const choice = defaultPick(availableAthletes(rosters[m], used), history, s);
      weekPicks[m] = choice;
      if (choice !== null) picks.push({ week, managerId: m, athleteId: choice });
    }

    const result = scoreWeek({
      week,
      settings: s,
      matchups: schedule[week - 1].map(([home, away], i) => ({ id: `w${week}-${i}`, home, away })),
      picks: weekPicks,
      statLines,
      acquiredWeek,
      standings,
    });
    for (const [a, score] of Object.entries(result.athleteScores)) (history[a] ??= []).push(score);
    standings = result.standings;
    weeks.push(result);
  }

  return { settings: s, rosters, picks, weeks, standings };
}
```

`scripts/sim.ts`:
```ts
import { simulateSeason } from '../src/core/simulate';

const [managers = '6', weeks = '10', seed = 'demo', settingsJson = '{}'] = process.argv.slice(2);
const n = Number(managers);
const result = simulateSeason({
  managers: n,
  athletes: n * 5,
  weeks: Number(weeks),
  seed,
  settings: JSON.parse(settingsJson),
  tournamentWeeks: [4, 8],
});

const table = [...result.standings]
  .sort((a, b) => b.points - a.points || b.totalScore - a.totalScore)
  .map((row, i) => ({ rank: i + 1, manager: row.managerId, points: +row.points.toFixed(2), score: +row.totalScore.toFixed(2) }));
console.table(table);
```

- [ ] **Step 3: Run tests and the CLI**

Run: `npx vitest run src/core`. Expected: PASS.
Run: `npm run sim -- 6 10 demo '{"upset_k":2}'`. Expected: a standings table prints.

- [ ] **Step 4: Commit**

`git commit -m "feat(core): season simulator and sim CLI for tuning settings"`

---

### Task 11: DB test harness, foundation schema and RLS

**Files:**
- Create: `tests/db/shim.sql`, `tests/db/helpers.ts`, `supabase/migrations/0001_foundation.sql`, `supabase/migrations/0002_rls.sql`, `tests/db/guards.test.ts`, `tests/db/rls.test.ts`

**Interfaces:**
- Produces (test helpers):
  - `freshDb(): Promise<PGlite>`
  - `createUser(db: PGlite, email: string): Promise<string>`
  - `makeAdmin(db: PGlite, userId: string): Promise<void>`
  - `as<T>(db: PGlite, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T>`, where null means the `anon` role
  - `rpc(tx: Transaction, fn: string, args: Record<string, unknown>): Promise<unknown>`
- Produces (SQL):
  - tables `profiles`, `user_roles`, `seasons`, `leagues`, `invites`, `memberships`, `athletes`, `audit_log`
  - schema `private`
  - functions `public.is_admin()` and `public.has_role(text)`

- [ ] **Step 1: Spike: confirm PGlite supports roles + RLS**

Create `tests/db/pglite-spike.test.ts`:
```ts
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('PGlite enforces RLS under set role', async () => {
  const db = new PGlite();
  await db.exec(`
    create role authenticated nologin;
    create table t (id int, owner text);
    alter table t enable row level security;
    grant select on t to authenticated;
    create policy p on t for select to authenticated using (owner = current_setting('app.me', true));
    insert into t values (1, 'x'), (2, 'y');
  `);
  const rows = await db.transaction(async (tx) => {
    await tx.exec(`select set_config('app.me', 'x', true); set local role authenticated;`);
    return (await tx.query('select id from t')).rows;
  });
  expect(rows).toEqual([{ id: 1 }]);
});
```
Run: `npx vitest run tests/db/pglite-spike.test.ts`. Expected: PASS.
**If it fails:** stop and report. The fallback is the `embedded-postgres` npm package with the same helpers, and that choice goes to the user. Delete the spike file after it passes.

- [ ] **Step 2: Supabase shim**

`tests/db/shim.sql`:
```sql
-- Minimal stand-ins for what a Supabase project already provides, so migrations run on PGlite.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase grants these by default on public; mirror them so the guard tests are meaningful.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
```

- [ ] **Step 3: Helpers**

`tests/db/helpers.ts`:
```ts
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(root + rel, 'utf8');

export async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(read('tests/db/shim.sql'));
  const files = readdirSync(root + 'supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) await db.exec(read(`supabase/migrations/${f}`));
  return db;
}

export async function createUser(db: PGlite, email: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  return id;
}

export async function makeAdmin(db: PGlite, userId: string): Promise<void> {
  await db.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [userId]);
}

/** Run `fn` as a signed-in user (or as anon when userId is null), like a PostgREST request. */
export function as<T>(db: PGlite, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
    return fn(tx);
  });
}

/** Call public.<fn>(p_x => $1, ...). Objects are sent as JSON text. */
export async function rpc(tx: Transaction, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const keys = Object.keys(args);
  const params = keys.map((k) => {
    const v = args[k];
    return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as result`;
  const res = await tx.query<{ result: unknown }>(sql, params);
  return res.rows[0]?.result;
}
```

- [ ] **Step 4: Write the failing guard + RLS tests**

`tests/db/guards.test.ts`:
```ts
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb } from './helpers';

let db: PGlite;
beforeAll(async () => { db = await freshDb(); });

describe('database guards', () => {
  it('enables RLS on every public table', async () => {
    const { rows } = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  it('never lets anon/authenticated write public tables directly', async () => {
    const { rows } = await db.query(`
      select grantee, table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`);
    expect(rows).toEqual([]);
  });

  it('never lets anon execute public functions', async () => {
    const { rows } = await db.query(`
      select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`);
    expect(rows).toEqual([]);
  });
});
```

`tests/db/rls.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin } from './helpers';

let db: PGlite;
let admin: string;
let alice: string;

beforeEach(async () => {
  db = await freshDb();
  admin = await createUser(db, 'admin@x.test');
  alice = await createUser(db, 'alice@x.test');
  await makeAdmin(db, admin);
  await db.exec(`
    insert into public.seasons (id, name) values ('00000000-0000-0000-0000-000000000001', 'Spring');
    insert into public.leagues (id, season_id, name) values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'A');
    insert into public.invites (code, league_id) values ('ABC123', '00000000-0000-0000-0000-000000000002');
    insert into public.audit_log (action, entity) values ('seed', 'test');`);
});

describe('RLS', () => {
  it('lets signed-in users read seasons and leagues', async () => {
    const rows = await as(db, alice, async (tx) => (await tx.query('select name from public.seasons')).rows);
    expect(rows).toEqual([{ name: 'Spring' }]);
  });

  it('gives anon nothing', async () => {
    await expect(as(db, null, (tx) => tx.query('select * from public.seasons'))).rejects.toThrow(/permission denied/);
  });

  it('hides invites and the audit log from non-admins', async () => {
    const inv = await as(db, alice, async (tx) => (await tx.query('select * from public.invites')).rows);
    const log = await as(db, alice, async (tx) => (await tx.query('select * from public.audit_log')).rows);
    expect(inv).toEqual([]);
    expect(log).toEqual([]);
    const adminInv = await as(db, admin, async (tx) => (await tx.query('select code from public.invites')).rows);
    expect(adminInv).toEqual([{ code: 'ABC123' }]);
  });

  it('shows users only their own roles unless admin', async () => {
    const mine = await as(db, alice, async (tx) => (await tx.query('select * from public.user_roles')).rows);
    expect(mine).toEqual([]);
    const all = await as(db, admin, async (tx) => (await tx.query('select role from public.user_roles')).rows);
    expect(all).toEqual([{ role: 'admin' }]);
  });

  it('rejects direct writes', async () => {
    await expect(as(db, admin, (tx) => tx.query(`insert into public.seasons (name) values ('Hack')`))).rejects.toThrow(/permission denied/);
  });
});
```

Run: `npx vitest run tests/db`. Expected: FAIL (the migrations folder is missing).

- [ ] **Step 5: Migrations**

`supabase/migrations/0001_foundation.sql`:
```sql
-- Foundation tables. Later milestones add their own tables in later migrations.
create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'stat_keeper', 'treasurer')),
  primary key (user_id, role)
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  status text not null default 'setup' check (status in ('setup', 'live', 'finished')),
  donations_open_at timestamptz,
  bid_close_at timestamptz,
  leftover_bid_close_at timestamptz,
  trade_deadline timestamptz,
  season_end_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (season_id, name)
);

create table public.invites (
  code text primary key check (code ~ '^[A-Z0-9]{6,20}$'),
  league_id uuid not null references public.leagues (id) on delete cascade,
  max_uses int not null default 50 check (max_uses > 0),
  uses int not null default 0 check (uses >= 0),
  expires_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  team_name text not null check (length(team_name) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (league_id, user_id),
  unique (league_id, team_name)
);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  user_id uuid references auth.users (id) on delete set null,
  opted_in boolean not null default true,
  created_at timestamptz not null default now(),
  unique (season_id, name)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  entity text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb
);
```

`supabase/migrations/0002_rls.sql`:
```sql
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.seasons enable row level security;
alter table public.leagues enable row level security;
alter table public.invites enable row level security;
alter table public.memberships enable row level security;
alter table public.athletes enable row level security;
alter table public.audit_log enable row level security;

-- Clients only ever read; every write goes through an RPC.
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;

create function public.has_role(p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = p_role)
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('admin')
$$;

create policy profiles_read on public.profiles for select to authenticated using (true);
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy seasons_read on public.seasons for select to authenticated using (true);
create policy leagues_read on public.leagues for select to authenticated using (true);
create policy invites_read on public.invites for select to authenticated using (public.is_admin());
create policy memberships_read on public.memberships for select to authenticated using (true);
create policy athletes_read on public.athletes for select to authenticated using (true);
create policy audit_log_read on public.audit_log for select to authenticated using (public.is_admin());

-- Functions: authenticated only. Re-run this block at the end of every migration that adds functions.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/db`. Expected: PASS.

- [ ] **Step 7: Commit**

`git commit -m "feat(db): foundation schema, RLS and PGlite test harness"`

Taskboard: t16 → `done` (note: "Foundation tables in 0001; each milestone adds its own tables"). t17 → `doing`.

---

### Task 12: Foundation RPCs and audit log

**Files:**
- Create: `supabase/migrations/0003_foundation_rpcs.sql`, `tests/db/rpc-foundation.test.ts`

**Interfaces:**
- Consumes: the Task 11 tables and helpers.
- Produces (all `public`, authenticated only, raising the listed codes):

| RPC | Returns | Errors |
|---|---|---|
| `set_display_name(p_name text)` | void | `NOT_SIGNED_IN`, `INVALID_NAME` |
| `create_season(p_name text, p_settings jsonb)` | uuid | `FORBIDDEN`, `INVALID_NAME`, `INVALID_SETTINGS` |
| `update_season_settings(p_season uuid, p_settings jsonb)` | void | `FORBIDDEN`, `NOT_FOUND`, `INVALID_SETTINGS` |
| `create_league(p_season uuid, p_name text)` | uuid | `FORBIDDEN`, `NOT_FOUND`, `INVALID_NAME`, `LEAGUE_EXISTS` |
| `create_invite(p_league uuid, p_code text, p_max_uses int, p_expires_at timestamptz)` | text (the normalized code) | `FORBIDDEN`, `NOT_FOUND`, `INVALID_CODE`, `CODE_TAKEN` |
| `add_athlete(p_season uuid, p_name text, p_user uuid)` | uuid | `FORBIDDEN`, `NOT_FOUND`, `INVALID_NAME`, `ATHLETE_EXISTS` |
| `set_athlete_opt_in(p_athlete uuid, p_opted_in boolean)` | void | `FORBIDDEN`, `NOT_FOUND` |
| `join_league(p_code text, p_team_name text)` | uuid (membership) | `NOT_SIGNED_IN`, `NO_PROFILE`, `INVALID_TEAM_NAME`, `INVALID_INVITE`, `ALREADY_MEMBER`, `TEAM_NAME_TAKEN` |
| `grant_role(p_user uuid, p_role text)` | void | `FORBIDDEN`, `INVALID_ROLE` |
| `revoke_role(p_user uuid, p_role text)` | void | `FORBIDDEN`, `LAST_ADMIN` |

- Also produces `private.audit(action, entity, entity_id, details)`, `private.require_user()` and `private.require_admin()`.

- [ ] **Step 1: Write the failing tests**

`tests/db/rpc-foundation.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin, rpc } from './helpers';

let db: PGlite;
let admin: string;
let alice: string;
let bob: string;

async function setupLeague(code = 'ABC123', maxUses = 50, expiresAt: string | null = null) {
  return as(db, admin, async (tx) => {
    const season = (await rpc(tx, 'create_season', { p_name: 'Spring 2027', p_settings: {} })) as string;
    const league = (await rpc(tx, 'create_league', { p_season: season, p_name: 'League A' })) as string;
    await rpc(tx, 'create_invite', { p_league: league, p_code: code, p_max_uses: maxUses, p_expires_at: expiresAt });
    return { season, league };
  });
}
const named = (id: string, name: string) => as(db, id, (tx) => rpc(tx, 'set_display_name', { p_name: name }));

beforeEach(async () => {
  db = await freshDb();
  admin = await createUser(db, 'admin@x.test');
  alice = await createUser(db, 'alice@x.test');
  bob = await createUser(db, 'bob@x.test');
  await makeAdmin(db, admin);
});

describe('admin RPCs', () => {
  it('rejects non-admins and anon', async () => {
    await expect(as(db, alice, (tx) => rpc(tx, 'create_season', { p_name: 'X', p_settings: {} }))).rejects.toThrow('FORBIDDEN');
    await expect(as(db, null, (tx) => rpc(tx, 'create_season', { p_name: 'X', p_settings: {} }))).rejects.toThrow(/permission denied/);
  });

  it('creates a season and writes an audit row', async () => {
    const { season } = await setupLeague();
    const log = await db.query<{ action: string; actor: string }>(
      `select action, actor from public.audit_log where entity_id = $1`, [season]);
    expect(log.rows).toEqual([{ action: 'create_season', actor: admin }]);
  });

  it('validates settings shape and names', async () => {
    await expect(as(db, admin, (tx) => rpc(tx, 'create_season', { p_name: 'X', p_settings: [1] }))).rejects.toThrow('INVALID_SETTINGS');
    await expect(as(db, admin, (tx) => rpc(tx, 'create_season', { p_name: '   ', p_settings: {} }))).rejects.toThrow('INVALID_NAME');
  });

  it('updates settings and logs old and new values', async () => {
    const { season } = await setupLeague();
    await as(db, admin, (tx) => rpc(tx, 'update_season_settings', { p_season: season, p_settings: { roster_size: 6 } }));
    const row = await db.query<{ settings: { roster_size: number } }>(`select settings from public.seasons where id = $1`, [season]);
    expect(row.rows[0].settings.roster_size).toBe(6);
    const log = await db.query<{ details: { old: unknown; new: unknown } }>(
      `select details from public.audit_log where action = 'update_season_settings'`);
    expect(log.rows[0].details).toEqual({ old: {}, new: { roster_size: 6 } });
  });

  it('normalizes invite codes and rejects bad or duplicate ones', async () => {
    const { league } = await setupLeague();
    const code = await as(db, admin, (tx) => rpc(tx, 'create_invite', { p_league: league, p_code: ' team2027 ', p_max_uses: 5, p_expires_at: null }));
    expect(code).toBe('TEAM2027');
    await expect(as(db, admin, (tx) => rpc(tx, 'create_invite', { p_league: league, p_code: 'team2027', p_max_uses: 5, p_expires_at: null }))).rejects.toThrow('CODE_TAKEN');
    await expect(as(db, admin, (tx) => rpc(tx, 'create_invite', { p_league: league, p_code: 'no!', p_max_uses: 5, p_expires_at: null }))).rejects.toThrow('INVALID_CODE');
  });

  it('adds athletes once per season and toggles opt-in', async () => {
    const { season } = await setupLeague();
    const id = (await as(db, admin, (tx) => rpc(tx, 'add_athlete', { p_season: season, p_name: 'Sam', p_user: null }))) as string;
    await expect(as(db, admin, (tx) => rpc(tx, 'add_athlete', { p_season: season, p_name: 'Sam', p_user: null }))).rejects.toThrow('ATHLETE_EXISTS');
    await as(db, admin, (tx) => rpc(tx, 'set_athlete_opt_in', { p_athlete: id, p_opted_in: false }));
    const row = await db.query<{ opted_in: boolean }>(`select opted_in from public.athletes where id = $1`, [id]);
    expect(row.rows[0].opted_in).toBe(false);
  });

  it('refuses to remove the last admin', async () => {
    await expect(as(db, admin, (tx) => rpc(tx, 'revoke_role', { p_user: admin, p_role: 'admin' }))).rejects.toThrow('LAST_ADMIN');
    await as(db, admin, (tx) => rpc(tx, 'grant_role', { p_user: alice, p_role: 'admin' }));
    await as(db, admin, (tx) => rpc(tx, 'revoke_role', { p_user: admin, p_role: 'admin' }));
    await expect(as(db, admin, (tx) => rpc(tx, 'create_season', { p_name: 'X', p_settings: {} }))).rejects.toThrow('FORBIDDEN');
  });
});

describe('join_league', () => {
  it('requires a display name first', async () => {
    await setupLeague();
    await expect(as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'ABC123', p_team_name: 'Hucks' }))).rejects.toThrow('NO_PROFILE');
  });

  it('joins with a messy, lowercase code and counts the use', async () => {
    await setupLeague();
    await named(alice, 'Alice');
    const id = await as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: ' abc123 ', p_team_name: 'Hucks' }));
    expect(typeof id).toBe('string');
    const inv = await db.query<{ uses: number }>(`select uses from public.invites where code = 'ABC123'`);
    expect(inv.rows[0].uses).toBe(1);
  });

  it('rejects joining twice and duplicate team names', async () => {
    await setupLeague();
    await named(alice, 'Alice');
    await named(bob, 'Bob');
    await as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'ABC123', p_team_name: 'Hucks' }));
    await expect(as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'ABC123', p_team_name: 'Other' }))).rejects.toThrow('ALREADY_MEMBER');
    await expect(as(db, bob, (tx) => rpc(tx, 'join_league', { p_code: 'ABC123', p_team_name: 'Hucks' }))).rejects.toThrow('TEAM_NAME_TAKEN');
  });

  it('rejects unknown, expired and used-up invites', async () => {
    await setupLeague('ONEUSE1', 1);
    await named(alice, 'Alice');
    await named(bob, 'Bob');
    await expect(as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'NOPE99', p_team_name: 'Hucks' }))).rejects.toThrow('INVALID_INVITE');
    await as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'ONEUSE1', p_team_name: 'Hucks' }));
    await expect(as(db, bob, (tx) => rpc(tx, 'join_league', { p_code: 'ONEUSE1', p_team_name: 'Zips' }))).rejects.toThrow('INVALID_INVITE');
    await setupLeague('OLDONE1', 5, '2020-01-01T00:00:00Z');
    await expect(as(db, bob, (tx) => rpc(tx, 'join_league', { p_code: 'OLDONE1', p_team_name: 'Zips' }))).rejects.toThrow('INVALID_INVITE');
  });
});
```

Note: the second `setupLeague` call in the last test creates "Spring 2027" again. Season names are not unique, so that's fine, and it creates "League A" in a new season, also fine.

Run: `npx vitest run tests/db/rpc-foundation.test.ts`. Expected: FAIL (functions don't exist).

- [ ] **Step 2: Implement `supabase/migrations/0003_foundation_rpcs.sql`**

```sql
-- Helpers (private schema is not exposed through the Data API).
create function private.audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

create function private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_SIGNED_IN'; end if;
  return uid;
end $$;

create function private.require_admin() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not exists (select 1 from public.user_roles where user_id = uid and role = 'admin') then
    raise exception 'FORBIDDEN';
  end if;
  return uid;
end $$;

create function private.clean_name(p_name text, p_max int) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := btrim(coalesce(p_name, ''));
begin
  if length(v) < 1 or length(v) > p_max then raise exception 'INVALID_NAME'; end if;
  return v;
end $$;

revoke all on all functions in schema private from public, anon, authenticated;

create function public.set_display_name(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); v text := private.clean_name(p_name, 60);
begin
  insert into public.profiles (id, display_name) values (uid, v)
  on conflict (id) do update set display_name = excluded.display_name;
  perform private.audit('set_display_name', 'profile', uid::text, jsonb_build_object('display_name', v));
end $$;

create function public.create_season(p_name text, p_settings jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid; v text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'INVALID_SETTINGS'; end if;
  insert into public.seasons (name, settings) values (v, p_settings) returning id into sid;
  perform private.audit('create_season', 'season', sid::text, jsonb_build_object('name', v, 'settings', p_settings));
  return sid;
end $$;

create function public.update_season_settings(p_season uuid, p_settings jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare old jsonb;
begin
  perform private.require_admin();
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then raise exception 'INVALID_SETTINGS'; end if;
  select settings into old from public.seasons where id = p_season for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update public.seasons set settings = p_settings where id = p_season;
  perform private.audit('update_season_settings', 'season', p_season::text, jsonb_build_object('old', old, 'new', p_settings));
end $$;

create function public.create_league(p_season uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare lid uuid; v text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  if not exists (select 1 from public.seasons where id = p_season) then raise exception 'NOT_FOUND'; end if;
  begin
    insert into public.leagues (season_id, name) values (p_season, v) returning id into lid;
  exception when unique_violation then raise exception 'LEAGUE_EXISTS';
  end;
  perform private.audit('create_league', 'league', lid::text, jsonb_build_object('season_id', p_season, 'name', v));
  return lid;
end $$;

create function public.create_invite(p_league uuid, p_code text, p_max_uses int, p_expires_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(); c text := upper(btrim(coalesce(p_code, '')));
begin
  if c !~ '^[A-Z0-9]{6,20}$' then raise exception 'INVALID_CODE'; end if;
  if not exists (select 1 from public.leagues where id = p_league) then raise exception 'NOT_FOUND'; end if;
  begin
    insert into public.invites (code, league_id, max_uses, expires_at, created_by)
    values (c, p_league, coalesce(p_max_uses, 50), p_expires_at, uid);
  exception when unique_violation then raise exception 'CODE_TAKEN';
  end;
  perform private.audit('create_invite', 'invite', c, jsonb_build_object('league_id', p_league, 'max_uses', p_max_uses, 'expires_at', p_expires_at));
  return c;
end $$;

create function public.add_athlete(p_season uuid, p_name text, p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare aid uuid; v text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  if not exists (select 1 from public.seasons where id = p_season) then raise exception 'NOT_FOUND'; end if;
  begin
    insert into public.athletes (season_id, name, user_id) values (p_season, v, p_user) returning id into aid;
  exception when unique_violation then raise exception 'ATHLETE_EXISTS';
  end;
  perform private.audit('add_athlete', 'athlete', aid::text, jsonb_build_object('season_id', p_season, 'name', v, 'user_id', p_user));
  return aid;
end $$;

create function public.set_athlete_opt_in(p_athlete uuid, p_opted_in boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  update public.athletes set opted_in = p_opted_in where id = p_athlete;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform private.audit('set_athlete_opt_in', 'athlete', p_athlete::text, jsonb_build_object('opted_in', p_opted_in));
end $$;

create function public.join_league(p_code text, p_team_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  inv public.invites;
  mid uuid;
  t text := btrim(coalesce(p_team_name, ''));
begin
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'NO_PROFILE'; end if;
  if length(t) < 1 or length(t) > 40 then raise exception 'INVALID_TEAM_NAME'; end if;
  select * into inv from public.invites where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or (inv.expires_at is not null and inv.expires_at <= now()) or inv.uses >= inv.max_uses then
    raise exception 'INVALID_INVITE';
  end if;
  begin
    insert into public.memberships (league_id, user_id, team_name) values (inv.league_id, uid, t) returning id into mid;
  exception when unique_violation then
    if exists (select 1 from public.memberships where league_id = inv.league_id and user_id = uid) then
      raise exception 'ALREADY_MEMBER';
    end if;
    raise exception 'TEAM_NAME_TAKEN';
  end;
  update public.invites set uses = uses + 1 where code = inv.code;
  perform private.audit('join_league', 'membership', mid::text, jsonb_build_object('league_id', inv.league_id, 'team_name', t, 'code', inv.code));
  return mid;
end $$;

create function public.grant_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_role not in ('admin', 'stat_keeper', 'treasurer') then raise exception 'INVALID_ROLE'; end if;
  insert into public.user_roles (user_id, role) values (p_user, p_role) on conflict do nothing;
  perform private.audit('grant_role', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

create function public.revoke_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin();
  if p_role = 'admin' and (select count(*) from public.user_roles where role = 'admin' and user_id <> p_user) = 0 then
    raise exception 'LAST_ADMIN';
  end if;
  delete from public.user_roles where user_id = p_user and role = p_role;
  perform private.audit('revoke_role', 'user', p_user::text, jsonb_build_object('role', p_role));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
```

- [ ] **Step 3: Run all DB tests**

Run: `npx vitest run tests/db`. Expected: PASS, including the guards test, which now covers the new functions.

- [ ] **Step 4: Commit**

`git commit -m "feat(db): foundation RPCs with audit log and error codes"`

Taskboard: t17 → `done` (note: "RLS + guard tests on PGlite; per-milestone tables add their own policies/tests"). t19 → `done` (note: "private.audit on every RPC; admin-only read").

---

### Task 13: App shell, auth and joining a league

**Files:**
- Create: `src/app/lib/supabase.ts`, `src/app/lib/errors.ts`, `src/app/lib/errors.test.ts`, `src/app/lib/rpc.ts`, `src/app/lib/useLoad.ts`, `src/app/lib/codes.ts`, `src/app/lib/codes.test.ts`, `src/app/auth/AuthProvider.tsx`, `src/app/components/Layout.tsx`, `src/app/pages/NotConfigured.tsx`, `src/app/pages/HomePage.tsx`, `src/app/pages/LoginPage.tsx`, `src/app/pages/JoinPage.tsx`, `src/app/styles.css`
- Modify: `src/app/App.tsx` (replace placeholder), `src/main.tsx` (import styles)

**Interfaces:**
- Consumes: the RPC names and error codes from Task 12.
- Produces:
  - `supabase: SupabaseClient | null`
  - `errorMessage(err: unknown): string`
  - `api.{setDisplayName, joinLeague, createSeason, updateSeasonSettings, createLeague, createInvite, addAthlete, setAthleteOptIn}`
  - `useLoad<T>(load, deps): { data?: T; error: string | null; reload(): void }`
  - `randomCode(length?: number): string`
  - `useAuth(): { session; loading; displayName; isAdmin; refresh }`

- [ ] **Step 1: Write the failing unit tests**

`src/app/lib/errors.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('maps RPC codes to plain language', () => {
    expect(errorMessage({ message: 'INVALID_INVITE' })).toMatch(/invalid, expired, or used up/);
    expect(errorMessage(new Error('FORBIDDEN'))).toMatch(/permission/);
  });
  it('falls back to the raw message', () => {
    expect(errorMessage({ message: 'socket hang up' })).toBe('Something went wrong: socket hang up');
    expect(errorMessage('boom')).toBe('Something went wrong: boom');
  });
});
```

`src/app/lib/codes.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { randomCode } from './codes';

describe('randomCode', () => {
  it('produces invite-safe codes without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const c = randomCode();
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
    expect(randomCode(12)).toHaveLength(12);
  });
});
```

Run: `npx vitest run src/app/lib`. Expected: FAIL.

- [ ] **Step 2: Implement the lib files**

`src/app/lib/supabase.ts`:
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null when the build has no Supabase config (the site then explains it isn't connected). */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } })
    : null;
```

`src/app/lib/errors.ts`:
```ts
const MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: 'The app is not connected to a database yet.',
  NOT_SIGNED_IN: 'Please sign in first.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That item doesn't exist.",
  INVALID_NAME: 'Names must be 1–60 characters.',
  INVALID_SETTINGS: 'Those season settings are not valid.',
  LEAGUE_EXISTS: 'That season already has a league with this name.',
  INVALID_CODE: 'Invite codes are 6–20 letters or digits.',
  CODE_TAKEN: 'That invite code already exists.',
  ATHLETE_EXISTS: 'An athlete with that name is already in this season.',
  NO_PROFILE: 'Set your display name first.',
  INVALID_TEAM_NAME: 'Team names must be 1–40 characters.',
  INVALID_INVITE: 'That invite code is invalid, expired, or used up.',
  ALREADY_MEMBER: "You're already in this league.",
  TEAM_NAME_TAKEN: 'Another team in this league already has that name.',
  INVALID_ROLE: 'Unknown role.',
  LAST_ADMIN: "You can't remove the last admin.",
};

export function errorMessage(err: unknown): string {
  const raw =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
  return MESSAGES[raw.trim()] ?? `Something went wrong: ${raw}`;
}
```

`src/app/lib/rpc.ts`:
```ts
import { supabase } from './supabase';

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('NOT_CONFIGURED');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export const api = {
  setDisplayName: (name: string) => call<void>('set_display_name', { p_name: name }),
  joinLeague: (code: string, teamName: string) => call<string>('join_league', { p_code: code, p_team_name: teamName }),
  createSeason: (name: string, settings: object) => call<string>('create_season', { p_name: name, p_settings: settings }),
  updateSeasonSettings: (seasonId: string, settings: object) =>
    call<void>('update_season_settings', { p_season: seasonId, p_settings: settings }),
  createLeague: (seasonId: string, name: string) => call<string>('create_league', { p_season: seasonId, p_name: name }),
  createInvite: (leagueId: string, code: string, maxUses: number, expiresAt: string | null) =>
    call<string>('create_invite', { p_league: leagueId, p_code: code, p_max_uses: maxUses, p_expires_at: expiresAt }),
  addAthlete: (seasonId: string, name: string) => call<string>('add_athlete', { p_season: seasonId, p_name: name, p_user: null }),
  setAthleteOptIn: (athleteId: string, optedIn: boolean) =>
    call<void>('set_athlete_opt_in', { p_athlete: athleteId, p_opted_in: optedIn }),
};
```

`src/app/lib/useLoad.ts`:
```ts
import { useEffect, useState, type DependencyList } from 'react';
import { errorMessage } from './errors';

export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (d) => { if (live) { setData(d); setError(null); } },
      (e) => { if (live) setError(errorMessage(e)); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}
```

`src/app/lib/codes.ts`:
```ts
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
```

Run: `npx vitest run src/app/lib`. Expected: PASS.

- [ ] **Step 3: Auth provider, layout and pages**

`src/app/auth/AuthProvider.tsx`:
```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
  displayName: string | null;
  isAdmin: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!supabase || !s) {
      setDisplayName(null);
      setIsAdmin(false);
      return;
    }
    const uid = s.user.id;
    const [profile, roles] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', uid),
    ]);
    setDisplayName(profile.data?.display_name ?? null);
    setIsAdmin((roles.data ?? []).some((r: { role: string }) => r.role === 'admin'));
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Supabase advises against awaiting other client calls inside this callback.
      setTimeout(() => void loadProfile(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const refresh = useCallback(() => loadProfile(session), [loadProfile, session]);

  return (
    <AuthContext.Provider value={{ session, loading, displayName, isAdmin, refresh }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```
`src/app/components/Layout.tsx`:
```tsx
import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

export function Layout() {
  const { session, isAdmin, displayName, loading } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">Tribe Fantasy</Link>
        <nav>
          {isAdmin && <Link to="/admin">Admin</Link>}
          {session ? (
            <button className="linklike" onClick={() => supabase?.auth.signOut()}>Sign out</button>
          ) : (
            <Link to="/login">Sign in</Link>
          )}
        </nav>
      </header>
      <main>
        {!loading && session && !displayName && (
          <p className="notice">Welcome! <Link to="/join">Set your name and join a league</Link>.</p>
        )}
        <Outlet />
      </main>
    </div>
  );
}
```

`src/app/pages/NotConfigured.tsx`:
```tsx
export function NotConfigured() {
  return (
    <main className="shell">
      <h1>Tribe Fantasy</h1>
      <p>This site is not connected to a database yet. An admin needs to finish the Supabase setup (see docs/setup-supabase.md).</p>
    </main>
  );
}
```

`src/app/pages/LoginPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

export function LoginPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to="/" replace />;

  async function sendEmail(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <section className="card">
      <h1>Sign in</h1>
      {!sent ? (
        <form onSubmit={sendEmail}>
          <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button disabled={busy}>Email me a sign-in link</button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <p>Check your email. Open the link <strong>on this device</strong>, or type the 6-digit code here:</p>
          <label>Code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <button disabled={busy}>Sign in</button>
          <button type="button" className="linklike" onClick={() => setSent(false)}>Use a different email</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
```

`src/app/pages/JoinPage.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';

export function JoinPage() {
  const { session, displayName, refresh } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return <Navigate to="/login" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!displayName) {
        await api.setDisplayName(name);
        await refresh();
      }
      await api.joinLeague(code, team);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h1>Join a league</h1>
      <form onSubmit={submit}>
        {!displayName && (
          <label>Your name<input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        )}
        <label>Invite code<input required value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" /></label>
        <label>Team name<input required maxLength={40} value={team} onChange={(e) => setTeam(e.target.value)} /></label>
        <button disabled={busy}>Join</button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
```

`src/app/pages/HomePage.tsx`:
```tsx
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';

interface MembershipRow {
  id: string;
  team_name: string;
  leagues: { name: string; seasons: { name: string } | null } | null;
}

export function HomePage() {
  const { session, loading } = useAuth();
  const uid = session?.user.id;
  const { data, error } = useLoad(async () => {
    if (!supabase || !uid) return [] as MembershipRow[];
    const { data, error } = await supabase
      .from('memberships')
      .select('id, team_name, leagues(name, seasons(name))')
      .eq('user_id', uid);
    if (error) throw error;
    return (data ?? []) as unknown as MembershipRow[];
  }, [uid]);

  if (loading) return <p>Loading…</p>;
  if (!session) {
    return (
      <section className="card">
        <h1>Tribe Fantasy</h1>
        <p>A fantasy league for our team. Every dollar goes to the team fund.</p>
        <Link to="/login" className="button">Sign in</Link>
      </section>
    );
  }
  return (
    <section>
      <h1>Your teams</h1>
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p>You're not in a league yet. <Link to="/join">Join with an invite code</Link>.</p>}
      <ul className="list">
        {data?.map((m) => (
          <li key={m.id}><strong>{m.team_name}</strong> · {m.leagues?.name} ({m.leagues?.seasons?.name})</li>
        ))}
      </ul>
      {data && data.length > 0 && <Link to="/join">Join another league</Link>}
    </section>
  );
}
```

`src/app/App.tsx` (replaces placeholder; the Admin route is added in Task 14):
```tsx
import { createHashRouter, RouterProvider } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { supabase } from './lib/supabase';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { LoginPage } from './pages/LoginPage';
import { NotConfigured } from './pages/NotConfigured';

const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'join', element: <JoinPage /> },
    ],
  },
]);

export function App() {
  if (!supabase) return <NotConfigured />;
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
```

`src/app/styles.css`:
```css
:root {
  --bg: #f7f7f5; --fg: #1c1c1c; --muted: #6b6b6b; --card: #ffffff; --line: #e3e3e0;
  --accent: #0b6e4f; --accent-fg: #ffffff; --error: #b3261e;
  color-scheme: light dark;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #151515; --fg: #ececec; --muted: #9a9a9a; --card: #1f1f1f; --line: #333; --accent: #3ba57d; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); }
.shell { max-width: 720px; margin: 0 auto; padding: 0 16px 48px; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--line); margin-bottom: 16px; }
.topbar nav { display: flex; gap: 16px; align-items: center; }
.brand { font-weight: 700; color: var(--fg); text-decoration: none; }
a { color: var(--accent); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
form { display: grid; gap: 12px; }
label { display: grid; gap: 4px; font-size: 14px; color: var(--muted); }
input, textarea, select { font: inherit; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg); min-height: 44px; }
textarea { font-family: ui-monospace, monospace; font-size: 13px; min-height: 240px; }
button, .button { font: inherit; min-height: 44px; padding: 10px 16px; border: 0; border-radius: 8px; background: var(--accent); color: var(--accent-fg); cursor: pointer; text-decoration: none; display: inline-block; }
button:disabled { opacity: 0.6; }
.linklike { background: none; color: var(--accent); padding: 0; min-height: 0; }
.error { color: var(--error); }
.notice { background: var(--card); border-left: 4px solid var(--accent); padding: 8px 12px; }
.list { list-style: none; padding: 0; display: grid; gap: 8px; }
.list li { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; }
.row > * { flex: 1 1 160px; }
```

Modify `src/main.tsx`: add `import './app/styles.css';` after the React imports.

- [ ] **Step 4: Verify**

Run: `npx vitest run`, `npm run lint`, `npm run typecheck`, `npm run build`. Expected: all pass. The App smoke test still passes because tests have no Supabase env.

- [ ] **Step 5: Commit**

`git commit -m "feat(app): auth with magic link or code, league join, home"`

---

### Task 14: Admin console (seasons, settings, leagues, invites, athletes)

**Files:**
- Create: `src/app/pages/admin/AdminPage.tsx`, `SeasonsPanel.tsx`, `SettingsEditor.tsx`, `LeaguesPanel.tsx`, `AthletesPanel.tsx`
- Modify: `src/app/App.tsx` (add the `admin` route)

**Interfaces:**
- Consumes: `api`, `useLoad`, `errorMessage`, `randomCode` (Task 13); `parseSettings`, `SettingsError`, `DEFAULT_SETTINGS` (Task 2).
- Produces: route `#/admin`, admin only.

- [ ] **Step 1: Implement**

`src/app/pages/admin/AdminPage.tsx`:
```tsx
import { useState } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { AthletesPanel } from './AthletesPanel';
import { LeaguesPanel } from './LeaguesPanel';
import { SeasonsPanel } from './SeasonsPanel';
import { SettingsEditor } from './SettingsEditor';

export function AdminPage() {
  const { isAdmin, loading } = useAuth();
  const [seasonId, setSeasonId] = useState<string | null>(null);
  if (loading) return <p>Loading…</p>;
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <section>
      <h1>Admin</h1>
      <SeasonsPanel selected={seasonId} onSelect={setSeasonId} />
      {seasonId && (
        <>
          <SettingsEditor seasonId={seasonId} />
          <LeaguesPanel seasonId={seasonId} />
          <AthletesPanel seasonId={seasonId} />
        </>
      )}
    </section>
  );
}
```

`src/app/pages/admin/SeasonsPanel.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { DEFAULT_SETTINGS } from '../../../core/settings';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface SeasonRow { id: string; name: string; status: string }

export function SeasonsPanel({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const seasons = useLoad(async () => {
    const { data, error } = await supabase!.from('seasons').select('id, name, status').order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SeasonRow[];
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const id = await api.createSeason(name, DEFAULT_SETTINGS);
      setName('');
      seasons.reload();
      onSelect(id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <h2>Seasons</h2>
      <ul className="list">
        {seasons.data?.map((s) => (
          <li key={s.id}>
            <span>{s.name} <small>({s.status})</small></span>
            <button className={selected === s.id ? '' : 'linklike'} onClick={() => onSelect(s.id)}>
              {selected === s.id ? 'Selected' : 'Manage'}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="row">
        <label>New season<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring 2027" /></label>
        <button>Create</button>
      </form>
      {(error || seasons.error) && <p className="error">{error ?? seasons.error}</p>}
    </div>
  );
}
```

`src/app/pages/admin/SettingsEditor.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { parseSettings, SettingsError } from '../../../core/settings';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

export function SettingsEditor({ seasonId }: { seasonId: string }) {
  const season = useLoad(async () => {
    const { data, error } = await supabase!.from('seasons').select('settings').eq('id', seasonId).single();
    if (error) throw error;
    return data.settings as unknown;
  }, [seasonId]);
  const [text, setText] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (season.data !== undefined) {
      try {
        setText(JSON.stringify(parseSettings(season.data), null, 2));
      } catch {
        setText(JSON.stringify(season.data, null, 2));
      }
    }
  }, [season.data]);

  async function save() {
    setIssues([]);
    setStatus(null);
    let parsed;
    try {
      parsed = parseSettings(JSON.parse(text));
    } catch (e) {
      setIssues(e instanceof SettingsError ? e.issues : [`Not valid JSON: ${(e as Error).message}`]);
      return;
    }
    try {
      await api.updateSeasonSettings(seasonId, parsed);
      setStatus('Saved.');
    } catch (err) {
      setIssues([errorMessage(err)]);
    }
  }

  return (
    <div className="card">
      <h2>Season settings</h2>
      <p>Every rule knob from the spec. Changes are validated here and recorded in the audit log.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <button onClick={save}>Validate and save</button>
      {status && <p>{status}</p>}
      {issues.length > 0 && <ul className="error">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
      {season.error && <p className="error">{season.error}</p>}
    </div>
  );
}
```

`src/app/pages/admin/LeaguesPanel.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { randomCode } from '../../lib/codes';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface LeagueRow {
  id: string;
  name: string;
  invites: { code: string; uses: number; max_uses: number; expires_at: string | null }[];
  memberships: { id: string; team_name: string }[];
}

export function LeaguesPanel({ seasonId }: { seasonId: string }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const leagues = useLoad(async () => {
    const { data, error } = await supabase!
      .from('leagues')
      .select('id, name, invites(code, uses, max_uses, expires_at), memberships(id, team_name)')
      .eq('season_id', seasonId)
      .order('name');
    if (error) throw error;
    return (data ?? []) as LeagueRow[];
  }, [seasonId]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      leagues.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api.createLeague(seasonId, name);
      setName('');
    });
  }

  return (
    <div className="card">
      <h2>Leagues and invites</h2>
      {leagues.data?.map((l) => (
        <div key={l.id} className="card">
          <h3>{l.name} <small>({l.memberships.length} teams)</small></h3>
          <ul className="list">
            {l.invites.map((i) => (
              <li key={i.code}><code>{i.code}</code><span>{i.uses}/{i.max_uses} used{i.expires_at ? ` · expires ${new Date(i.expires_at).toLocaleDateString()}` : ''}</span></li>
            ))}
            {l.memberships.map((m) => <li key={m.id}>{m.team_name}</li>)}
          </ul>
          <button onClick={() => void run(() => api.createInvite(l.id, randomCode(), 50, null))}>New invite code</button>
        </div>
      ))}
      <form onSubmit={create} className="row">
        <label>New league<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="League A" /></label>
        <button>Create</button>
      </form>
      {(error || leagues.error) && <p className="error">{error ?? leagues.error}</p>}
    </div>
  );
}
```

`src/app/pages/admin/AthletesPanel.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface AthleteRow { id: string; name: string; opted_in: boolean }

export function AthletesPanel({ seasonId }: { seasonId: string }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const athletes = useLoad(async () => {
    const { data, error } = await supabase!.from('athletes').select('id, name, opted_in').eq('season_id', seasonId).order('name');
    if (error) throw error;
    return (data ?? []) as AthleteRow[];
  }, [seasonId]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      athletes.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api.addAthlete(seasonId, name);
      setName('');
    });
  }

  const count = athletes.data?.filter((a) => a.opted_in).length ?? 0;
  return (
    <div className="card">
      <h2>Athletes <small>({count} opted in)</small></h2>
      <ul className="list">
        {athletes.data?.map((a) => (
          <li key={a.id}>
            <span style={{ opacity: a.opted_in ? 1 : 0.5 }}>{a.name}</span>
            <button className="linklike" onClick={() => void run(() => api.setAthleteOptIn(a.id, !a.opted_in))}>
              {a.opted_in ? 'Opt out' : 'Opt back in'}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="row">
        <label>Add athlete<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button>Add</button>
      </form>
      {(error || athletes.error) && <p className="error">{error ?? athletes.error}</p>}
    </div>
  );
}
```

Modify `src/app/App.tsx`: add `import { AdminPage } from './pages/admin/AdminPage';` and the child route `{ path: 'admin', element: <AdminPage /> }`.

- [ ] **Step 2: Verify**

Run: `npx vitest run`, `npm run lint`, `npm run typecheck`, `npm run build`. Expected: all pass.

- [ ] **Step 3: Commit**

`git commit -m "feat(app): admin console for seasons, settings, leagues, invites, athletes"`

Taskboard: t18 → `doing` (note: "Seasons/settings/leagues/invites/athletes done; weeks, members, credits, corrections come with their milestones").

---

### Task 15: Connect Supabase and go live (needs the user)

**Files:**
- Create: `docs/setup-supabase.md`

- [ ] **Step 1: Write the setup guide**

`docs/setup-supabase.md`:
````markdown
# Supabase setup (tribe-dev and, later, tribe-prod)

1. Create a free project at supabase.com named `tribe-dev`. Save the database password in your own password manager. Never paste it into the repo or into chat.
2. **Apply migrations:** in the dashboard, open SQL Editor, then paste and run each file in `supabase/migrations/` in numeric order.
3. **Auth → URL Configuration:**
   - Site URL: `https://nealthezeng.github.io/Tribe-Fantasy/`
   - Redirect URLs: add `https://nealthezeng.github.io/Tribe-Fantasy/` and `http://localhost:5173/Tribe-Fantasy/`.
4. **Auth → Email Templates → Magic Link:** add the line `Or enter this code: {{ .Token }}` so people can sign in on a different device than the one that opened the email.
5. **Auth → SMTP:** Supabase's built-in email only reaches your own project team and is heavily rate-limited, so teammates need a custom SMTP sender (see "Email sender" below).
6. **Project Settings → API:** copy the Project URL and the `anon` `public` key. Set them as GitHub repo variables (not secrets; both are public by design):
   ```
   gh variable set VITE_SUPABASE_URL --body "<url>"
   gh variable set VITE_SUPABASE_ANON_KEY --body "<anon key>"
   ```
   Then re-run the Deploy workflow.
7. **First admin:** sign in once on the site, then in SQL Editor run:
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = '<your email>';
   ```
8. **Local dev:** create `.env.local` (gitignored) with the same two `VITE_` values and run `npm run dev`.

## Email sender

The options:
- **Gmail app password:** simplest, about 500 emails a day.
- **Brevo free tier:** 300 a day, verifies a single sender address.
- **Resend:** needs a domain you own.

Whichever you pick, put its SMTP credentials into the Supabase dashboard only.
````

- [ ] **Step 2: User actions (stop and ask)**

Ask the user to:
1. Create the `tribe-dev` project.
2. Choose an email sender.
3. Send the Project URL and the anon key.

Then run step 6's `gh variable set` commands (the anon key is public), trigger the Deploy workflow, and walk the user through steps 2–5 and 7 in the dashboard, since they own that account.

- [ ] **Step 3: End-to-end check on the live site**

Using the browser pane at `https://nealthezeng.github.io/Tribe-Fantasy/`:
1. The site loads and shows the Sign in page, not "not connected".
2. The user signs in by email and becomes admin (step 7).
3. The user creates a season, edits a setting (e.g. `roster_size: 6`) and saves; a bad key shows a validation issue.
4. The user creates a league and an invite code, and adds two athletes.
5. A second account joins with the code typed in lowercase.

- [ ] **Step 4: Commit**

`git add docs/setup-supabase.md; git commit -m "docs: Supabase setup guide"; git push`

Taskboard: t14 → `done`, t15 → `done` (note: "Magic link + 6-digit code; invite codes required to join a league").

---

## After M1 + M2

- Build a graphify knowledge graph of the repo (`/graphify`) so future sessions can query the structure instead of re-reading files.
- Next plan: M3 (stats), starting with t20, evaluating the team's stat app export format, which needs the user.

## Gates carried from M1+M2 reviews

- **Before M3 adds RPCs:** ✅ done in M3 (tests/db/rpc-gate.test.ts) — one structural test calling every admin RPC as a non-admin, expecting `FORBIDDEN`, plus an audit-row check per RPC.
- **M3:** ✅ done (0004_stats.sql check constraint) — enforce `points_played >= 0` with a check constraint.
- **M5:** replace the `private.owns_athlete()` stub (always false in 0004) with a `roster_slots` check, add tests for
  `OWNS_ATHLETE` on save_taps / verify_session / confirm_injury, and grey out owned athletes on the tally screen,
  or reject per tap instead of per batch (one owned-athlete tap currently drops the whole batch).
- **M6:** injury pick rules: a free re-pick if the picked athlete has a confirmed, uncleared injury before `pick_lock_at`;
  a week where the picked athlete had an active injury and no counted session does not use up the athlete.
  Rescore every week touched by a `correct_stat_line` audit row (`details.rescore_needed`).
- **M6:** `scoreWeek` input comes from `stat_lines` of sessions with `counts = true` that are locked.
- **M5 (owns_athlete follow-ups):** once `owns_athlete` is real, also block owners in `reopen_session` (else an owner can keep a session from ever locking), `set_attendance` by a keeper, `correct_stat_line` by an admin who owns the athlete, and `report_injury` auto-confirm when the keeper is the athlete's own linked user.
- **M6 (lock drift):** any reopen of an already-scored session must trigger a rescore, and raising `stat_lock_hours` re-opens old sessions — snapshot or re-check locks when scoring.
- **M5, before real credits:**
  - a property test that no eligible higher bid is ever skipped;
  - golden-value tests pinning `hashSeed`, `mulberry32` and `fillLeftovers`;
  - compare `placed_at` as normalized integer µs (Date.parse drops µs and returns NaN on bad input);
  - enforce `allow_self_ownership` in `fillLeftovers`.
- **M6:** a missing `acquiredWeek` must throw instead of defaulting to multiplier 1; the caller pushes `absent_score` into default-pick history for weeks without stat lines.
- **M5 (wallet, from M4):** add `bid` to the `credit_ledger.kind` check and a SQL `balance(membership)` helper;
  adjustments can leave a balance negative, so bidding must refuse (`INSUFFICIENT_CREDITS`) rather than assume ≥ 0.
- **M6 (allowance, from M4):** replace the `private.standings_points()` stub (always 0 in 0006) with real standings
  points, and add a `grant_stage_allowance` test on real standings. It must never return NULL: NULL sorts first under `order by p desc` in grant_stage_allowance, so a member with no points would rank best.
- **Every new migration:** add an explicit `grant select ... to authenticated` next to its policies (default privileges are revoked), re-run the function grant loop, and keep extensions out of `public`.
