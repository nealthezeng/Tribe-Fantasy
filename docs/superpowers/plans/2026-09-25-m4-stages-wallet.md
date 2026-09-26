# M4: Stages and wallet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Invoke `ponytail:ponytail` before writing code.

**Goal:** Admins split the league year into stages and grant each stage's rank-based credit allowance. Every team has a credit wallet. The treasurer can record donations to the team (off in the beta). Leagues cap at `max_members`. The three M3 follow-ups are fixed.

**Architecture:**
- A new migration `0006` adds `stages` and an append-only `credit_ledger`.
- All writes go through audited security-definer RPCs.
- The allowance is computed in SQL inside `grant_stage_allowance`. Its ranks come from a `private.standings_points()` stub that returns 0 until M6.
- The client sums ledger entries for balances. RLS lets only the owner, treasurers and admins read them.
- Two admin panels (Stages, Wallets) and a wallet card on the home page make up the UI.

**Tech Stack:** unchanged: Vite + React 19 + react-router (hash routing), supabase-js 2, Vitest, and PGlite for DB tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-25-m4-stages-wallet-design.md`, which builds §1–3 and §9 of `2026-09-25-year-stages-revision.md`.

## Global Constraints

- No new npm dependencies. `src/core` imports nothing outside `src/core`.
- Defaults: `allowance_base` 100, `allowance_gap` 30, `max_members` 6, `roster_size` 4, `donations_enabled` false, `credits_per_dollar` 20. SQL `coalesce` fallbacks must equal `DEFAULT_SETTINGS`.
- Allowance formula: `round(allowance_base + allowance_gap × (r − 1) / (n − 1))`, where r is the average rank among ties and 1 is best. It is `allowance_base` when n < 2.
- Every donation is a **donation to the team** (fund). Any UI text about a donation says so. The app never holds or moves money. Credits have no cash value.
- Balances are visible to the owner, treasurers and admins only.
- Every `public` table has RLS on and an explicit `grant select … to authenticated`. Clients never write tables. `anon` executes nothing. A migration that adds functions ends with the function grant loop. Never edit 0001–0005.
- Every RPC raises bare upper-snake error codes and writes `audit_log` via `private.audit` on success. It checks the caller's role (`require_admin` / `require_treasurer`) before touching its arguments.
- Node is at `C:\Program Files\nodejs`, not on the Bash PATH, so prefix commands with `export PATH="/c/Program Files/nodejs:$PATH";`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `m4-stages-wallet` (or a worktree of it). Don't merge or push until the final review passes and the user has pasted 0006.

## Review Focus

- **A shared phone where one user signs out and another signs in, and the new user's profile fetch fails.** The new user must never see the previous user's name or admin/keeper UI.
  - Task 6's AuthProvider change handles this.
  - There's no AuthProvider test harness, and building one is out of proportion, so the final review checks it live: sign in as admin, sign out, sign in as a member with the network throttled.
- **A tally board reopened after a save that landed but whose storage wasn't cleared.** Counts must not double, and "Undo last tap" must really undo.
  - Test: `queue.test.ts` "saved taps still in a reopened queue" (Task 6).
- **The live database migrated while the old app build is still deployed, or the reverse.** The old settings editor rejects `max_members` and the other new keys, which is the same trap as `tap_merge_seconds` in M3.
  - Task 7's hand-off: paste 0006, then merge and push in one go.
  - Test: "strips the retired keys from seasons saved before M4" (Task 2).
- **A season saved with `{}` settings (or saved before M4) whose SQL fallbacks drift from `DEFAULT_SETTINGS`.** A drift would hand out the wrong allowance or the wrong league cap.
  - Tests: Task 2's allowance, donation and cap tests derive their expected values from `DEFAULT_SETTINGS`.
- **Grant allowance pressed before everyone joined, pressed twice, or pressed by two admins at once.** No one may be credited twice, and late joiners must still get theirs.
  - Test: "only late joiners on a re-run" (Task 2).
  - Two admins at once is handled by `on conflict … do nothing` on the partial unique index. PGlite has a single connection, so this is reasoned, not tested.

## Execution notes

- Every code block below was run before this plan was written: 191 tests, `tsc`, `eslint` and `vite build` all passed with the full change applied.
  - The full, verified change set is saved as git stash `m4-verified-draft` on branch `m4-stages-wallet`.
  - An implementer may copy a task's files out of it with `git checkout stash@{0} -- <paths>` instead of retyping. Use `git stash list` to find the right index.
  - They must still run each task's failing-test step (copy the tests first), read the code, and commit per task.
- Diffs are against commit `1a2cac3` (the spec commit). Tasks may run in order 1 → 7. Tasks 3–6 depend only on 1–2 and on the names in their **Interfaces** block.
- Model per task, from the user's preference:
  - haiku where the code is given in full with no judgment calls (Tasks 1, 3, 5, 7).
  - sonnet for DB and UI integration (Tasks 2, 4, 6).
  - opus for the security review after Task 2, and for the final review of the whole branch.
- **After the final review:**
  1. Give the user `0006_stages_wallet.sql` to paste.
  2. Run the live checks: add a stage, grant the allowance, adjust a team, see the wallet on the home page as a member, the user-switch check above, and confirm the donation form stays hidden.
  3. Merge to `main` and push. That deploys.
  4. Check off taskboard items and update memory.

## File map

```
src/core/settings.ts, simulate.ts            new settings, retired keys, sim budget
supabase/migrations/0006_stages_wallet.sql   stages, credit_ledger, RLS, 5 RPCs, join_league cap     (new)
tests/db/helpers.ts                          freshDb(stopBefore?), migrationSql
tests/db/rpc-wallet.test.ts                  stages, allowance, donations, adjustments, RLS, cap      (new)
tests/db/rpc-gate.test.ts                    audit steps for the new RPCs
src/app/lib/wallet.ts                        LedgerEntry, LEDGER_COLUMNS, balance, entryLabel         (new)
src/app/lib/rpc.ts, errors.ts                api calls, error messages
src/app/pages/admin/StagesPanel.tsx          stages list/form, Grant allowance                        (new)
src/app/pages/admin/WalletsPanel.tsx         balances, adjustments, donations to the team            (new)
src/app/pages/admin/AdminPage.tsx            shows both panels
src/app/pages/HomePage.tsx                   wallet card per team
src/app/tally/queue.ts, pages/TallyPage.tsx  M3 follow-ups 1 and 3
src/app/auth/AuthProvider.tsx                M3 follow-up 2
docs/setup-supabase.md, m1-m2 plan gates     go-live steps; M5/M6 gates
```

---

### Task 1: Settings for stages and wallet  (model: haiku)

**Files:**
- Modify: `src/core/settings.ts`
- Modify: `src/core/simulate.ts`
- Test: `src/core/settings.test.ts`, `src/core/simulate.test.ts`

**Interfaces:**
- Produces: `SeasonSettings` gains `donations_enabled: boolean`, `allowance_base: number`, `allowance_gap: number`, `max_members: number`; loses `min_credits_to_play`, `extra_credit_cap`, `free_entry`. `DEFAULT_SETTINGS.roster_size` is 4. Task 2's SQL fallbacks and Task 4's WalletsPanel read these names.

- [ ] **Step 1: Write the failing tests**

Apply to `src/core/settings.test.ts`:

```diff
@@ -9,8 +9,11 @@ describe('parseSettings', () => {
 
   it('has the agreed money and scoring defaults', () => {
     expect(DEFAULT_SETTINGS.credits_per_dollar).toBe(20);
-    expect(DEFAULT_SETTINGS.min_credits_to_play).toBe(100);
-    expect(DEFAULT_SETTINGS.extra_credit_cap).toBeNull();
+    expect(DEFAULT_SETTINGS.donations_enabled).toBe(false);
+    expect(DEFAULT_SETTINGS.allowance_base).toBe(100);
+    expect(DEFAULT_SETTINGS.allowance_gap).toBe(30);
+    expect(DEFAULT_SETTINGS.max_members).toBe(6);
+    expect(DEFAULT_SETTINGS.roster_size).toBe(4);
     expect(DEFAULT_SETTINGS.normalize_mode).toBe('none');
     expect(DEFAULT_SETTINGS.stat_weights).toEqual({ goal: 3, assist: 3, block: 3, callahan: 8, turnover: -2 });
     expect(DEFAULT_SETTINGS.tap_merge_seconds).toBe(10);
@@ -59,6 +62,20 @@ describe('parseSettings', () => {
     expect(() => parseSettings({ stat_weights: { goal: 'x' } })).toThrow(/stat_weights/);
   });
 
+  it('bounds the M4 wallet and league-size settings', () => {
+    for (const bad of [{ max_members: 1 }, { max_members: 51 }, { allowance_base: -1 }, { allowance_gap: 2.5 },
+      { donations_enabled: 'yes' }]) {
+      expect(() => parseSettings(bad), JSON.stringify(bad)).toThrow(SettingsError);
+    }
+    expect(parseSettings({ max_members: 8, roster_size: 3 }).max_members).toBe(8);
+  });
+
+  it('rejects the settings retired by the stages revision', () => {
+    for (const key of ['min_credits_to_play', 'free_entry', 'extra_credit_cap']) {
+      expect(() => parseSettings({ [key]: null })).toThrow(`unknown setting "${key}"`);
+    }
+  });
+
   it('only takes stat names the database can store (lowercase letters and _, up to 30)', () => {
     for (const bad of ['Goal', 'hockey-assist', 'layout d', '', 'a'.repeat(31)]) {
       expect(() => parseSettings({ stat_weights: { [bad]: 1 } })).toThrow(/stat_weights key/);
```

The simulator tests assert rosters of 5; pin that explicitly so they keep testing the same thing after the default changes:

Apply to `src/core/simulate.test.ts`:

```diff
@@ -2,7 +2,7 @@ import { describe, expect, it } from 'vitest';
 import { simulateSeason } from './simulate';
 
 describe('simulateSeason', () => {
-  const r = simulateSeason({ managers: 6, athletes: 30, weeks: 10, seed: 'test', tournamentWeeks: [4, 8] });
+  const r = simulateSeason({ managers: 6, athletes: 30, weeks: 10, seed: 'test', tournamentWeeks: [4, 8], settings: { roster_size: 5 } });
 
   it('drafts full, exclusive rosters', () => {
     const all = Object.values(r.rosters).flat();
@@ -44,11 +44,11 @@ describe('simulateSeason', () => {
   });
 
   it('is deterministic per seed', () => {
-    expect(simulateSeason({ managers: 6, athletes: 30, weeks: 10, seed: 'test', tournamentWeeks: [4, 8] })).toEqual(r);
+    expect(simulateSeason({ managers: 6, athletes: 30, weeks: 10, seed: 'test', tournamentWeeks: [4, 8], settings: { roster_size: 5 } })).toEqual(r);
   });
 
   it('copes with more roster capacity than athletes and an odd manager count', () => {
-    const odd = simulateSeason({ managers: 7, athletes: 30, weeks: 6, seed: 'odd' });
+    const odd = simulateSeason({ managers: 7, athletes: 30, weeks: 6, seed: 'odd', settings: { roster_size: 5 } });
     expect(Object.values(odd.rosters).flat()).toHaveLength(30);
     expect(odd.weeks).toHaveLength(6);
   });
```

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/core`
Expected: FAIL: `allowance_base` etc. undefined; retired keys not rejected.

- [ ] **Step 3: Implement**

Apply to `src/core/settings.ts`:

```diff
@@ -2,9 +2,10 @@ export type SessionType = 'practice' | 'tournament';
 
 export interface SeasonSettings {
   credits_per_dollar: number;
-  min_credits_to_play: number;
-  extra_credit_cap: number | null;
-  free_entry: boolean;
+  donations_enabled: boolean;
+  allowance_base: number;
+  allowance_gap: number;
+  max_members: number;
   roster_size: number;
   min_bid: number;
   exclusive_ownership: boolean;
@@ -36,10 +37,11 @@ export interface SeasonSettings {
 
 export const DEFAULT_SETTINGS: SeasonSettings = {
   credits_per_dollar: 20,
-  min_credits_to_play: 100,
-  extra_credit_cap: null,
-  free_entry: false,
-  roster_size: 5,
+  donations_enabled: false,
+  allowance_base: 100,
+  allowance_gap: 30,
+  max_members: 6,
+  roster_size: 4,
   min_bid: 1,
   exclusive_ownership: true,
   allow_self_ownership: false,
@@ -114,9 +116,10 @@ const statWeights: Check = (v) => {
 
 const CHECKS: Record<keyof SeasonSettings, Check> = {
   credits_per_dollar: num(1, 10_000, true),
-  min_credits_to_play: num(0, 10_000_000, true),
-  extra_credit_cap: nullable(num(0, 1_000_000_000, true)),
-  free_entry: bool,
+  donations_enabled: bool,
+  allowance_base: num(0, 100_000, true),
+  allowance_gap: num(0, 100_000, true),
+  max_members: num(2, 50, true),
   roster_size: num(1, 30, true),
   min_bid: num(0, 10_000_000, true),
   exclusive_ownership: bool,
```

Apply to `src/core/simulate.ts`:

```diff
@@ -36,7 +36,7 @@ export function simulateSeason(cfg: SimConfig): SimResult {
 
   const budgets: ManagerBudget[] = managerIds.map((managerId) => ({
     managerId,
-    budget: s.min_credits_to_play + Math.floor(rand() * 200),
+    budget: s.allowance_base + Math.floor(rand() * 200),
     openSlots: s.roster_size,
   }));
   const bids: Bid[] = [];
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/core && npx tsc`
Expected: all src/core tests PASS; tsc prints nothing.

`tsc` fails if anything else still reads a removed key: delete that use (there should be none besides simulate.ts).

- [ ] **Step 5: Commit**

```bash
git add src/core/settings.ts src/core/settings.test.ts src/core/simulate.ts src/core/simulate.test.ts
git commit -m "feat(core): M4 settings: allowance, max_members, donations_enabled; roster 4" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 0006: stages, credit ledger, allowance, donations, league cap  (model: sonnet; then opus security review)

**Files:**
- Create: `supabase/migrations/0006_stages_wallet.sql`
- Modify: `tests/db/helpers.ts` (`freshDb(stopBefore?)`, `migrationSql`)
- Create: `tests/db/rpc-wallet.test.ts`
- Modify: `tests/db/rpc-gate.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS` names from Task 1 (SQL fallbacks mirror them; the tests import it).
- Produces tables `public.stages (id, season_id, name, starts_on, ends_on, tournament, created_at)` and `public.credit_ledger (id, membership_id, stage_id, kind, amount, dollars, note, created_by, created_at)`; RPCs `create_stage(p_season, p_name, p_starts_on, p_ends_on, p_tournament) → uuid`, `update_stage(p_stage, p_name, p_starts_on, p_ends_on, p_tournament) → void`, `grant_stage_allowance(p_stage) → int`, `record_donation(p_membership, p_dollars, p_note) → bigint`, `adjust_credits(p_membership, p_amount, p_note) → bigint`; `join_league` raises `LEAGUE_FULL`. New error codes: `INVALID_DATES`, `STAGE_OVERLAP`, `STAGE_EXISTS`, `LEAGUE_FULL`, `DONATIONS_DISABLED`, `INVALID_AMOUNT`, `NOTE_REQUIRED`, `INVALID_NOTE`. Private helpers `setting_num`, `standings_points` (stub = 0, M6 gate), `require_treasurer`, `check_stage`, `clean_optional`.

- [ ] **Step 1: Let tests stop before a migration**

Apply to `tests/db/helpers.ts`:

```diff
@@ -5,14 +5,20 @@ import { fileURLToPath } from 'node:url';
 const root = fileURLToPath(new URL('../../', import.meta.url));
 const read = (rel: string) => readFileSync(root + rel, 'utf8');
 
-export async function freshDb(): Promise<PGlite> {
+/** A database with every migration applied, or only those sorting before `stopBefore` (e.g. '0006'). */
+export async function freshDb(stopBefore?: string): Promise<PGlite> {
   const db = new PGlite();
   await db.exec(read('tests/db/shim.sql'));
   const files = readdirSync(root + 'supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
-  for (const f of files) await db.exec(read(`supabase/migrations/${f}`));
+  for (const f of files) {
+    if (stopBefore && f >= stopBefore) break;
+    await db.exec(migrationSql(f));
+  }
   return db;
 }
 
+export const migrationSql = (file: string) => read(`supabase/migrations/${file}`);
+
 export async function createUser(db: PGlite, email: string): Promise<string> {
   const id = crypto.randomUUID();
   await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
```

- [ ] **Step 2: Write the failing tests**

Create `tests/db/rpc-wallet.test.ts` with exactly:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { as, createUser, freshDb, makeAdmin, migrationSql, rpc } from './helpers';

let db: PGlite;
let admin: string;
let season: string;
let league: string;

const settings = (s: object) => as(db, admin, (tx) => rpc(tx, 'update_season_settings', { p_season: season, p_settings: s }));
const stage = (name: string, starts: string, ends: string, tournament: string | null = null) =>
  as(db, admin, (tx) => rpc(tx, 'create_stage', {
    p_season: season, p_name: name, p_starts_on: starts, p_ends_on: ends, p_tournament: tournament,
  })) as Promise<string>;
const grant = (stageId: string) => as(db, admin, (tx) => rpc(tx, 'grant_stage_allowance', { p_stage: stageId }));

/** A signed-up user with a profile who joined `league`; returns [userId, membershipId]. */
async function member(name: string, code = 'LEAGUE1'): Promise<[string, string]> {
  const uid = await createUser(db, `${name}@x.test`);
  await as(db, uid, (tx) => rpc(tx, 'set_display_name', { p_name: name }));
  const mid = (await as(db, uid, (tx) => rpc(tx, 'join_league', { p_code: code, p_team_name: name }))) as string;
  return [uid, mid];
}
const amounts = async (mid: string) =>
  (await db.query<{ kind: string; amount: number }>(
    `select kind, amount from public.credit_ledger where membership_id = $1 order by id`, [mid])).rows;
const pointsAre = (byMembership: Record<string, number>) =>
  db.exec(`create or replace function private.standings_points(p_membership uuid) returns numeric
    language sql stable security definer set search_path = '' as $$
      select coalesce((('${JSON.stringify(byMembership)}'::jsonb) ->> p_membership::text)::numeric, 0)
    $$;`);

beforeEach(async () => {
  db = await freshDb();
  admin = await createUser(db, 'admin@x.test');
  await makeAdmin(db, admin);
  await as(db, admin, async (tx) => {
    season = (await rpc(tx, 'create_season', { p_name: '2026-27', p_settings: {} })) as string;
    league = (await rpc(tx, 'create_league', { p_season: season, p_name: 'League A' })) as string;
    await rpc(tx, 'create_invite', { p_league: league, p_code: 'LEAGUE1', p_max_uses: 50, p_expires_at: null });
  });
});

describe('stages', () => {
  it('creates stages, refuses overlaps, bad dates and duplicate names, and audits', async () => {
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08', 'Nov tourney');
    await expect(stage('Clash', '2026-11-08', '2026-11-20')).rejects.toThrow('STAGE_OVERLAP');
    await expect(stage('Backwards', '2027-02-10', '2027-02-01')).rejects.toThrow('INVALID_DATES');
    await expect(stage('Fall beta', '2027-01-01', '2027-01-20')).rejects.toThrow('STAGE_EXISTS');
    await expect(stage('Blank tournament ok', '2027-01-01', '2027-01-20', '  ')).resolves.toBeTruthy();
    const row = await db.query<{ tournament: string }>(`select tournament from public.stages where id = $1`, [fall]);
    expect(row.rows[0].tournament).toBe('Nov tourney');
    const log = await db.query(`select 1 from public.audit_log where action = 'create_stage'`);
    expect(log.rows).toHaveLength(2);
  });

  it('updates a stage without tripping over its own dates', async () => {
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    await stage('Spring 1', '2027-02-01', '2027-02-21');
    const update = (starts: string, ends: string) => as(db, admin, (tx) => rpc(tx, 'update_stage', {
      p_stage: fall, p_name: 'Fall', p_starts_on: starts, p_ends_on: ends, p_tournament: null }));
    await update('2026-10-19', '2026-11-09');
    await expect(update('2026-10-19', '2027-02-01')).rejects.toThrow('STAGE_OVERLAP');
    const row = await db.query<{ name: string; ends_on: string }>(`select name, ends_on::text from public.stages where id = $1`, [fall]);
    expect(row.rows[0]).toEqual({ name: 'Fall', ends_on: '2026-11-09' });
  });

  it('is admin-only to write and readable by any signed-in user', async () => {
    const [alice] = await member('alice');
    await expect(as(db, alice, (tx) => rpc(tx, 'create_stage', {
      p_season: season, p_name: 'X', p_starts_on: '2026-10-01', p_ends_on: '2026-10-02', p_tournament: null,
    }))).rejects.toThrow('FORBIDDEN');
    await stage('Fall beta', '2026-10-18', '2026-11-08');
    const outsider = await createUser(db, 'out@x.test');
    const rows = await as(db, outsider, (tx) => tx.query(`select name from public.stages`));
    expect(rows.rows).toHaveLength(1);
  });
});

describe('grant_stage_allowance', () => {
  it('gives everyone base + gap/2 while all are tied, and only late joiners on a re-run', async () => {
    // Season saved with {}: the SQL fallbacks must match DEFAULT_SETTINGS (100 + 30 / 2 = 115).
    const tied = DEFAULT_SETTINGS.allowance_base + DEFAULT_SETTINGS.allowance_gap / 2;
    expect(tied).toBe(115);
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    const [, a] = await member('alice');
    const [, b] = await member('bob');
    expect(await grant(fall)).toBe(2);
    expect(await amounts(a)).toEqual([{ kind: 'allowance', amount: tied }]);
    const [, c] = await member('carol');
    expect(await grant(fall)).toBe(1);
    expect(await amounts(c)).toEqual([{ kind: 'allowance', amount: tied }]);
    expect(await amounts(b)).toHaveLength(1);
  });

  it('pays the worst rank the most and shares tied ranks', async () => {
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    const [, a] = await member('alice');
    const [, b] = await member('bob');
    const [, c] = await member('carol');
    const [, d] = await member('dave');
    // ranks: a 1, b and c tied for 2-3 (2.5), d 4. n = 4 → 100 + 30 × (r − 1) / 3
    await pointsAre({ [a]: 9, [b]: 5, [c]: 5, [d]: 1 });
    await grant(fall);
    expect((await amounts(a))[0].amount).toBe(100);
    expect((await amounts(b))[0].amount).toBe(115);
    expect((await amounts(c))[0].amount).toBe(115);
    expect((await amounts(d))[0].amount).toBe(130);
  });

  it('uses the season settings, ranks per league, rounds, and gives base alone to a lone member', async () => {
    await settings({ allowance_base: 50, allowance_gap: 10 });
    await as(db, admin, async (tx) => {
      const id = (await rpc(tx, 'create_league', { p_season: season, p_name: 'League B' })) as string;
      await rpc(tx, 'create_invite', { p_league: id, p_code: 'LEAGUE2', p_max_uses: 50, p_expires_at: null });
    });
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    const [, a] = await member('alice');
    const [, b] = await member('bob');
    const [, c] = await member('carol');
    const [, solo] = await member('solo', 'LEAGUE2');
    await pointsAre({ [a]: 3, [b]: 2, [c]: 1 });
    await grant(fall);
    expect((await amounts(b))[0].amount).toBe(55);
    expect((await amounts(c))[0].amount).toBe(60);
    expect((await amounts(solo))[0].amount).toBe(50);
    await pointsAre({});
    await settings({ allowance_base: 100, allowance_gap: 25 });
    const spring = await stage('Spring 1', '2027-02-01', '2027-02-21');
    await grant(spring);
    expect((await amounts(a))[1].amount).toBe(113); // 112.5 rounds half up
  });

  it('still lets a season with stages and ledger entries be deleted', async () => {
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    await member('alice');
    await grant(fall);
    await db.query(`delete from public.seasons where id = $1`, [season]);
    const left = await db.query(`select 1 from public.credit_ledger union all select 1 from public.stages`);
    expect(left.rows).toEqual([]);
  });

  it('skips zero allowances and is admin-only', async () => {
    await settings({ allowance_base: 0, allowance_gap: 0 });
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    const [alice, a] = await member('alice');
    expect(await grant(fall)).toBe(0);
    expect(await amounts(a)).toEqual([]);
    await expect(as(db, alice, (tx) => rpc(tx, 'grant_stage_allowance', { p_stage: fall }))).rejects.toThrow('FORBIDDEN');
  });
});

describe('donations and adjustments', () => {
  it('refuses donations while donations_enabled is off', async () => {
    const [, a] = await member('alice');
    await expect(as(db, admin, (tx) => rpc(tx, 'record_donation', { p_membership: a, p_dollars: 5, p_note: null })))
      .rejects.toThrow('DONATIONS_DISABLED');
  });

  it('lets a treasurer record a donation to the team at credits_per_dollar', async () => {
    await settings({ donations_enabled: true });
    const [alice, a] = await member('alice');
    const treasurer = await createUser(db, 't@x.test');
    await db.query(`insert into public.user_roles (user_id, role) values ($1, 'treasurer')`, [treasurer]);
    await as(db, treasurer, (tx) => rpc(tx, 'record_donation', { p_membership: a, p_dollars: 12.5, p_note: ' Venmo to club ' }));
    const row = await db.query<{ kind: string; amount: number; dollars: string; note: string; created_by: string }>(
      `select kind, amount, dollars::text, note, created_by from public.credit_ledger where membership_id = $1`, [a]);
    expect(row.rows).toEqual([{
      kind: 'donation', amount: 12.5 * DEFAULT_SETTINGS.credits_per_dollar, dollars: '12.50', note: 'Venmo to club',
      created_by: treasurer,
    }]);
    await expect(as(db, alice, (tx) => rpc(tx, 'record_donation', { p_membership: a, p_dollars: 5, p_note: null })))
      .rejects.toThrow('FORBIDDEN');
    for (const bad of [0, -5, 10000.01, 1.234, 0.01]) {
      await expect(as(db, admin, (tx) => rpc(tx, 'record_donation', { p_membership: a, p_dollars: bad, p_note: null })))
        .rejects.toThrow('INVALID_AMOUNT');
    }
  });

  it('adjusts credits with a required note, admin only', async () => {
    const [alice, a] = await member('alice');
    const adjust = (who: string, amount: number, note: string | null) =>
      as(db, who, (tx) => rpc(tx, 'adjust_credits', { p_membership: a, p_amount: amount, p_note: note }));
    await expect(adjust(admin, -10, '  ')).rejects.toThrow('NOTE_REQUIRED');
    await expect(adjust(admin, 0, 'x')).rejects.toThrow('INVALID_AMOUNT');
    await expect(adjust(alice, 10, 'x')).rejects.toThrow('FORBIDDEN');
    await expect(adjust(admin, 10, 'x'.repeat(201))).rejects.toThrow('INVALID_NOTE');
    await adjust(admin, -10, 'double allowance');
    expect(await amounts(a)).toEqual([{ kind: 'adjustment', amount: -10 }]);
  });
});

describe('credit_ledger reads', () => {
  it('shows members only their own entries; treasurers and admins see all; outsiders none', async () => {
    await settings({ donations_enabled: true });
    const [alice, a] = await member('alice');
    const [, b] = await member('bob');
    await as(db, admin, (tx) => rpc(tx, 'adjust_credits', { p_membership: a, p_amount: 5, p_note: 'a' }));
    await as(db, admin, (tx) => rpc(tx, 'adjust_credits', { p_membership: b, p_amount: 7, p_note: 'b' }));
    const read = (uid: string) => as(db, uid, (tx) => tx.query<{ amount: number }>(`select amount from public.credit_ledger order by id`));
    expect((await read(alice)).rows).toEqual([{ amount: 5 }]);
    expect((await read(admin)).rows).toHaveLength(2);
    const treasurer = await createUser(db, 't@x.test');
    await db.query(`insert into public.user_roles (user_id, role) values ($1, 'treasurer')`, [treasurer]);
    expect((await read(treasurer)).rows).toHaveLength(2);
    expect((await read(await createUser(db, 'out@x.test'))).rows).toEqual([]);
  });
});

describe('join_league cap', () => {
  it('refuses joins past max_members, across invites, but still says ALREADY_MEMBER first', async () => {
    await settings({ max_members: 2 });
    await as(db, admin, (tx) => rpc(tx, 'create_invite', { p_league: league, p_code: 'OTHER1', p_max_uses: 50, p_expires_at: null }));
    const [alice] = await member('alice');
    await member('bob', 'OTHER1');
    await expect(member('carol')).rejects.toThrow('LEAGUE_FULL');
    await expect(as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'OTHER1', p_team_name: 'again' })))
      .rejects.toThrow('ALREADY_MEMBER');
  });

  it('defaults to DEFAULT_SETTINGS.max_members (6)', async () => {
    for (let i = 1; i <= DEFAULT_SETTINGS.max_members; i++) await member(`m${i}`);
    await expect(member('one_more')).rejects.toThrow('LEAGUE_FULL');
  });
});

describe('0006 settings cleanup', () => {
  it('strips the retired keys from seasons saved before M4', async () => {
    const old = await freshDb('0006');
    await old.query(`insert into public.seasons (name, settings)
      values ('old', '{"min_credits_to_play":100,"free_entry":false,"extra_credit_cap":null,"roster_size":5}')`);
    await old.exec(migrationSql('0006_stages_wallet.sql'));
    const row = await old.query<{ settings: object }>(`select settings from public.seasons`);
    expect(row.rows[0].settings).toEqual({ roster_size: 5 });
  });
});
```

And register the five new RPCs in the gate test (it discovers RPCs from `pg_proc`, so it fails until every new RPC has an audit step):

Apply to `tests/db/rpc-gate.test.ts`:

```diff
@@ -52,10 +52,17 @@ describe('RPC gate', () => {
     const steps: [string, string, () => Record<string, unknown>, ((r: unknown) => void)?][] = [
       ['set_display_name', player, () => ({ p_name: 'Pat' })],
       ['create_season', admin, () => ({ p_name: 'Gate', p_settings: {} }), (r) => (c.season = r as string)],
-      ['update_season_settings', admin, () => ({ p_season: c.season, p_settings: {} })],
+      ['update_season_settings', admin, () => ({ p_season: c.season, p_settings: { donations_enabled: true } })],
       ['create_league', admin, () => ({ p_season: c.season, p_name: 'L' }), (r) => (c.league = r as string)],
       ['create_invite', admin, () => ({ p_league: c.league, p_code: 'GATE01', p_max_uses: 5, p_expires_at: null })],
-      ['join_league', player, () => ({ p_code: 'GATE01', p_team_name: 'Pats' })],
+      ['join_league', player, () => ({ p_code: 'GATE01', p_team_name: 'Pats' }), (r) => (c.membership = r as string)],
+      ['create_stage', admin, () => ({ p_season: c.season, p_name: 'Fall', p_starts_on: '2026-10-18', p_ends_on: '2026-11-08',
+        p_tournament: null }), (r) => (c.stage = r as string)],
+      ['update_stage', admin, () => ({ p_stage: c.stage, p_name: 'Fall beta', p_starts_on: '2026-10-18',
+        p_ends_on: '2026-11-08', p_tournament: 'Nov' })],
+      ['grant_stage_allowance', admin, () => ({ p_stage: c.stage })],
+      ['record_donation', admin, () => ({ p_membership: c.membership, p_dollars: 5, p_note: null })],
+      ['adjust_credits', admin, () => ({ p_membership: c.membership, p_amount: -1, p_note: 'gate' })],
       ['add_athlete', admin, () => ({ p_season: c.season, p_name: 'Pat', p_user: null }), (r) => (c.athlete = r as string)],
       ['set_athlete_opt_in', admin, () => ({ p_athlete: c.athlete, p_opted_in: true })],
       ['link_athlete_user', admin, () => ({ p_athlete: c.athlete, p_user: player })],
```

- [ ] **Step 3: Run them to see them fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run tests/db/rpc-wallet.test.ts`
Expected: FAIL: `function public.create_stage(...) does not exist`.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/0006_stages_wallet.sql` with exactly:

```sql
-- M4 stages and wallet. Spec: docs/superpowers/specs/2026-09-25-m4-stages-wallet-design.md
create table public.stages (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  starts_on date not null,
  ends_on date not null,
  tournament text check (length(tournament) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (season_id, name),
  check (ends_on >= starts_on)
);

-- Append-only. Balance = sum(amount). Every donation is a donation to the team fund; the app never holds money.
create table public.credit_ledger (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  -- Cascade: no RPC deletes a stage, so this only fires when its whole season is deleted.
  stage_id uuid references public.stages (id) on delete cascade,
  kind text not null check (kind in ('allowance', 'donation', 'adjustment')),
  amount int not null check (amount <> 0),
  dollars numeric(10, 2) check (dollars > 0),
  note text check (length(note) between 1 and 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'donation') = (dollars is not null))
);
create index credit_ledger_membership_idx on public.credit_ledger (membership_id);
create unique index credit_ledger_one_allowance on public.credit_ledger (membership_id, stage_id) where kind = 'allowance';

alter table public.stages enable row level security;
alter table public.credit_ledger enable row level security;
grant select on public.stages, public.credit_ledger to authenticated;
create policy stages_read on public.stages for select to authenticated using (true);
create policy credit_ledger_read on public.credit_ledger for select to authenticated using (
  membership_id in (select id from public.memberships where user_id = auth.uid())
  or public.has_role('treasurer') or public.is_admin());

-- Retired settings (stages revision §6).
update public.seasons set settings = settings - 'min_credits_to_play' - 'free_entry' - 'extra_credit_cap';

-- Fallbacks mirror DEFAULT_SETTINGS in src/core/settings.ts (seasons stored with {} settings).
create function private.setting_num(p_season uuid, p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((settings ->> p_key)::numeric, p_default) from public.seasons where id = p_season
$$;

-- ponytail: 0 for everyone until M6 builds standings, so every allowance is base + gap/2. M6 must replace this body (gate).
create function private.standings_points(p_membership uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select 0::numeric
$$;

create function private.require_treasurer() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := private.require_user();
begin
  if not exists (select 1 from public.user_roles where user_id = uid and role in ('admin', 'treasurer')) then
    raise exception 'FORBIDDEN';
  end if;
  return uid;
end $$;

-- Raises unless the dates are valid and don't overlap another stage of the season. Callers lock the season row.
create function private.check_stage(p_season uuid, p_stage uuid, p_starts date, p_ends date) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_starts is null or p_ends is null or p_ends < p_starts then raise exception 'INVALID_DATES'; end if;
  if exists (select 1 from public.stages where season_id = p_season and id is distinct from p_stage
             and starts_on <= p_ends and ends_on >= p_starts) then
    raise exception 'STAGE_OVERLAP';
  end if;
end $$;

-- Blank or null → null; otherwise the same 1..p_max rule as names.
create function private.clean_optional(p_text text, p_max int) returns text
language plpgsql immutable set search_path = '' as $$
declare v text := nullif(btrim(coalesce(p_text, '')), '');
begin
  return case when v is null then null else private.clean_name(v, p_max) end;
end $$;

revoke all on all functions in schema private from public, anon, authenticated;

create function public.create_stage(p_season uuid, p_name text, p_starts_on date, p_ends_on date, p_tournament text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare sid uuid; v text; t text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  t := private.clean_optional(p_tournament, 60);
  perform 1 from public.seasons where id = p_season for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform private.check_stage(p_season, null, p_starts_on, p_ends_on);
  begin
    insert into public.stages (season_id, name, starts_on, ends_on, tournament)
    values (p_season, v, p_starts_on, p_ends_on, t) returning id into sid;
  exception when unique_violation then raise exception 'STAGE_EXISTS';
  end;
  perform private.audit('create_stage', 'stage', sid::text, jsonb_build_object(
    'season_id', p_season, 'name', v, 'starts_on', p_starts_on, 'ends_on', p_ends_on, 'tournament', t));
  return sid;
end $$;

create function public.update_stage(p_stage uuid, p_name text, p_starts_on date, p_ends_on date, p_tournament text)
returns void language plpgsql security definer set search_path = '' as $$
declare old public.stages; v text; t text;
begin
  perform private.require_admin();
  v := private.clean_name(p_name, 60);
  t := private.clean_optional(p_tournament, 60);
  select * into old from public.stages where id = p_stage;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from public.seasons where id = old.season_id for update;
  perform private.check_stage(old.season_id, p_stage, p_starts_on, p_ends_on);
  begin
    update public.stages set name = v, starts_on = p_starts_on, ends_on = p_ends_on, tournament = t where id = p_stage;
  exception when unique_violation then raise exception 'STAGE_EXISTS';
  end;
  perform private.audit('update_stage', 'stage', p_stage::text, jsonb_build_object(
    'old', to_jsonb(old) - 'id' - 'season_id' - 'created_at',
    'new', jsonb_build_object('name', v, 'starts_on', p_starts_on, 'ends_on', p_ends_on, 'tournament', t)));
end $$;

-- Credits every membership of the stage's season that has no allowance for this stage yet (re-runs pick up
-- late joiners). Amount = round(base + gap × (r − 1) / (n − 1)), r = average rank among ties, 1 = best.
create function public.grant_stage_allowance(p_stage uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(); st public.stages; base numeric; gap numeric; credited int;
begin
  select * into st from public.stages where id = p_stage;
  if not found then raise exception 'NOT_FOUND'; end if;
  base := private.setting_num(st.season_id, 'allowance_base', 100);
  gap := private.setting_num(st.season_id, 'allowance_gap', 30);
  with pts as (
    select m.id, m.league_id, private.standings_points(m.id) as p
    from public.memberships m join public.leagues l on l.id = m.league_id
    where l.season_id = st.season_id
  ), ranked as (
    select id,
      count(*) over (partition by league_id) as n,
      rank() over (partition by league_id order by p desc)
        + (count(*) over (partition by league_id, p) - 1) / 2.0 as r
    from pts
  ), ins as (
    insert into public.credit_ledger (membership_id, stage_id, kind, amount, created_by)
    select id, p_stage, 'allowance', a, uid
    from (select id, round(case when n < 2 then base else base + gap * (r - 1) / (n - 1) end)::int as a from ranked) x
    where a <> 0
    on conflict (membership_id, stage_id) where kind = 'allowance' do nothing
    returning 1
  )
  select count(*) into credited from ins;
  perform private.audit('grant_stage_allowance', 'stage', p_stage::text, jsonb_build_object('credited', credited));
  return credited;
end $$;

-- The treasurer has already received the money through the official team channel; this only records it.
create function public.record_donation(p_membership uuid, p_dollars numeric, p_note text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_treasurer(); sid uuid; n text; credits int; eid bigint;
begin
  select l.season_id into sid from public.memberships m join public.leagues l on l.id = m.league_id where m.id = p_membership;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not coalesce((select (settings ->> 'donations_enabled')::boolean from public.seasons where id = sid), false) then
    raise exception 'DONATIONS_DISABLED';
  end if;
  if p_dollars is null or p_dollars <= 0 or p_dollars > 10000 or p_dollars <> round(p_dollars, 2) then
    raise exception 'INVALID_AMOUNT';
  end if;
  n := nullif(btrim(coalesce(p_note, '')), '');
  if length(n) > 200 then raise exception 'INVALID_NOTE'; end if;
  credits := round(p_dollars * private.setting_num(sid, 'credits_per_dollar', 20));
  if credits < 1 then raise exception 'INVALID_AMOUNT'; end if;
  insert into public.credit_ledger (membership_id, kind, amount, dollars, note, created_by)
  values (p_membership, 'donation', credits, p_dollars, n, uid) returning id into eid;
  perform private.audit('record_donation', 'membership', p_membership::text,
    jsonb_build_object('ledger_id', eid, 'dollars', p_dollars, 'credits', credits));
  return eid;
end $$;

-- The only way to fix a mistake: the ledger is append-only.
create function public.adjust_credits(p_membership uuid, p_amount int, p_note text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_admin(); n text := nullif(btrim(coalesce(p_note, '')), ''); eid bigint;
begin
  if not exists (select 1 from public.memberships where id = p_membership) then raise exception 'NOT_FOUND'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then raise exception 'INVALID_AMOUNT'; end if;
  if n is null then raise exception 'NOTE_REQUIRED'; end if;
  if length(n) > 200 then raise exception 'INVALID_NOTE'; end if;
  insert into public.credit_ledger (membership_id, kind, amount, note, created_by)
  values (p_membership, 'adjustment', p_amount, n, uid) returning id into eid;
  perform private.audit('adjust_credits', 'membership', p_membership::text,
    jsonb_build_object('ledger_id', eid, 'amount', p_amount, 'note', n));
  return eid;
end $$;

-- 0003's join_league plus the max_members cap (LEAGUE_FULL).
create or replace function public.join_league(p_code text, p_team_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  inv public.invites;
  sid uuid;
  mid uuid;
  t text := btrim(coalesce(p_team_name, ''));
begin
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'NO_PROFILE'; end if;
  if length(t) < 1 or length(t) > 40 then raise exception 'INVALID_TEAM_NAME'; end if;
  select * into inv from public.invites where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or (inv.expires_at is not null and inv.expires_at <= now()) or inv.uses >= inv.max_uses then
    raise exception 'INVALID_INVITE';
  end if;
  -- Lock the league, not just the invite: two invites to one league mustn't both take the last spot.
  select season_id into sid from public.leagues where id = inv.league_id for update;
  if exists (select 1 from public.memberships where league_id = inv.league_id and user_id = uid) then
    raise exception 'ALREADY_MEMBER';
  end if;
  if (select count(*) from public.memberships where league_id = inv.league_id)
     >= private.setting_num(sid, 'max_members', 6) then
    raise exception 'LEAGUE_FULL';
  end if;
  begin
    insert into public.memberships (league_id, user_id, team_name) values (inv.league_id, uid, t) returning id into mid;
  exception when unique_violation then raise exception 'TEAM_NAME_TAKEN';
  end;
  update public.invites set uses = uses + 1 where code = inv.code;
  perform private.audit('join_league', 'membership', mid::text, jsonb_build_object('league_id', inv.league_id, 'team_name', t, 'code', inv.code));
  return mid;
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

Notes for the implementer:
- `stage_id ... on delete cascade` is deliberate: with plain `no action`, deleting a season fails (the test "still lets a season with stages and ledger entries be deleted" pins this). No RPC deletes a stage.
- `join_league` is redefined whole with `create or replace` (never edit 0003). It now locks the **league** row, so two invite codes for one league can't both take the last spot, and it checks `ALREADY_MEMBER` before `LEAGUE_FULL`.
- `grant_stage_allowance` uses `on conflict ... where kind = 'allowance' do nothing` against the partial unique index, so two admins pressing the button at once can't double-credit.

- [ ] **Step 5: Run all DB tests**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run tests/db`
Expected: all PASS (9 files), including guards.test.ts (RLS on, no client writes, anon nothing) with the two new tables.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0006_stages_wallet.sql tests/db/helpers.ts tests/db/rpc-wallet.test.ts tests/db/rpc-gate.test.ts
git commit -m "feat(db): 0006 stages, credit ledger, allowance, donations to the team, league cap" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Client plumbing: api calls, error messages, wallet helpers  (model: haiku)

**Files:**
- Modify: `src/app/lib/rpc.ts`, `src/app/lib/errors.ts`
- Create: `src/app/lib/wallet.ts`
- Test: `src/app/lib/errors.test.ts`, `src/app/lib/wallet.test.ts`

**Interfaces:**
- Consumes: the RPC names and error codes from Task 2.
- Produces: `api.createStage(seasonId, name, startsOn, endsOn, tournament: string | null): Promise<string>`, `api.updateStage(stageId, name, startsOn, endsOn, tournament): Promise<void>`, `api.grantStageAllowance(stageId): Promise<number>`, `api.recordDonation(membershipId, dollars: number, note): Promise<number>`, `api.adjustCredits(membershipId, amount: number, note): Promise<number>`; `wallet.ts` exports `LedgerEntry`, `LEDGER_COLUMNS`, `balance(entries)`, `entryLabel(entry)`. Tasks 4 and 5 use all of these.

- [ ] **Step 1: Write the failing tests**

Create `src/app/lib/wallet.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest';
import { balance, entryLabel, type LedgerEntry } from './wallet';

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: 1, kind: 'allowance', amount: 115, dollars: null, note: null, created_at: '2026-10-18T12:00:00Z', stages: null, ...over,
});

describe('wallet', () => {
  it('sums a balance', () => {
    expect(balance([entry({ amount: 115 }), entry({ amount: 250 }), entry({ amount: -10 })])).toBe(355);
    expect(balance([])).toBe(0);
  });

  it('says a donation is a donation to the team', () => {
    expect(entryLabel(entry({ kind: 'donation', amount: 250, dollars: '12.50' }))).toBe('Donation to the team — $12.50');
    expect(entryLabel(entry({ kind: 'allowance', stages: { name: 'Fall beta' } }))).toBe('Allowance — Fall beta');
    expect(entryLabel(entry({ kind: 'adjustment', amount: -10, note: 'double allowance' }))).toBe('Adjustment — double allowance');
  });
});
```

Apply to `src/app/lib/errors.test.ts`:

```diff
@@ -13,6 +13,10 @@ describe('errorMessage', () => {
     expect(errorMessage({ message: 'VERIFIER_TAPPED' })).toMatch(/another keeper has to verify/);
     expect(errorMessage({ message: 'NOT_YOUR_ATHLETE' })).toMatch(/your own attendance/);
   });
+  it('maps the M4 wallet codes', () => {
+    expect(errorMessage({ message: 'LEAGUE_FULL' })).toMatch(/full/);
+    expect(errorMessage({ message: 'DONATIONS_DISABLED' })).toMatch(/donations to the team/);
+  });
   it('falls back to the raw message', () => {
     expect(errorMessage({ message: 'socket hang up' })).toBe('Something went wrong: socket hang up');
     expect(errorMessage('boom')).toBe('Something went wrong: boom');
```

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/app/lib`
Expected: FAIL: cannot find `./wallet`; LEAGUE_FULL falls back to "Something went wrong".

- [ ] **Step 3: Implement**

Create `src/app/lib/wallet.ts` with exactly:

```ts
/** A credit_ledger row as the client reads it (with LEDGER_COLUMNS). */
export interface LedgerEntry {
  id: number;
  kind: 'allowance' | 'donation' | 'adjustment';
  amount: number;
  dollars: number | string | null; // numeric(10,2)
  note: string | null;
  created_at: string;
  stages: { name: string } | null;
}

export const LEDGER_COLUMNS = 'id, kind, amount, dollars, note, created_at, stages(name)';

export const balance = (entries: Pick<LedgerEntry, 'amount'>[]) => entries.reduce((sum, e) => sum + e.amount, 0);

export function entryLabel(e: LedgerEntry): string {
  switch (e.kind) {
    case 'allowance': return `Allowance — ${e.stages?.name ?? 'season'}`;
    case 'donation': return `Donation to the team — $${Number(e.dollars).toFixed(2)}`;
    case 'adjustment': return `Adjustment — ${e.note ?? ''}`;
  }
}
```

Apply to `src/app/lib/errors.ts`:

```diff
@@ -31,6 +31,14 @@ const MESSAGES: Record<string, string> = {
   NOT_YOUR_ATHLETE: 'You can only update your own attendance and injuries.',
   INVALID_STATUS: 'Attendance must be present or absent.',
   USER_ALREADY_LINKED: 'That account is already linked to another athlete this season.',
+  INVALID_DATES: 'The end date must be on or after the start date.',
+  STAGE_OVERLAP: 'Those dates overlap another stage.',
+  STAGE_EXISTS: 'A stage with that name already exists this year.',
+  LEAGUE_FULL: 'This league is full.',
+  DONATIONS_DISABLED: 'Recording donations to the team is turned off for this season.',
+  INVALID_AMOUNT: "That amount isn't valid.",
+  NOTE_REQUIRED: 'Add a note saying why.',
+  INVALID_NOTE: 'Notes must be 200 characters or fewer.',
 };
 
 export function errorMessage(err: unknown): string {
```

Apply to `src/app/lib/rpc.ts`:

```diff
@@ -38,4 +38,17 @@ export const api = {
   reportInjury: (athleteId: string) => call<string>('report_injury', { p_athlete: athleteId }),
   confirmInjury: (injuryId: string) => call<void>('confirm_injury', { p_injury: injuryId }),
   clearInjury: (athleteId: string) => call<void>('clear_injury', { p_athlete: athleteId }),
+  createStage: (seasonId: string, name: string, startsOn: string, endsOn: string, tournament: string | null) =>
+    call<string>('create_stage', {
+      p_season: seasonId, p_name: name, p_starts_on: startsOn, p_ends_on: endsOn, p_tournament: tournament,
+    }),
+  updateStage: (stageId: string, name: string, startsOn: string, endsOn: string, tournament: string | null) =>
+    call<void>('update_stage', {
+      p_stage: stageId, p_name: name, p_starts_on: startsOn, p_ends_on: endsOn, p_tournament: tournament,
+    }),
+  grantStageAllowance: (stageId: string) => call<number>('grant_stage_allowance', { p_stage: stageId }),
+  recordDonation: (membershipId: string, dollars: number, note: string) =>
+    call<number>('record_donation', { p_membership: membershipId, p_dollars: dollars, p_note: note }),
+  adjustCredits: (membershipId: string, amount: number, note: string) =>
+    call<number>('adjust_credits', { p_membership: membershipId, p_amount: amount, p_note: note }),
 };
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/app/lib && npx tsc`
Expected: PASS; tsc prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/app/lib/rpc.ts src/app/lib/errors.ts src/app/lib/errors.test.ts src/app/lib/wallet.ts src/app/lib/wallet.test.ts
git commit -m "feat(app): wallet helpers, stage/credit api calls, M4 error messages" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Admin console: Stages and Wallets panels  (model: sonnet)

**Files:**
- Create: `src/app/pages/admin/StagesPanel.tsx`, `src/app/pages/admin/WalletsPanel.tsx`
- Modify: `src/app/pages/admin/AdminPage.tsx`

**Interfaces:**
- Consumes: `api.*` and `balance` from Task 3, `DEFAULT_SETTINGS.credits_per_dollar` from Task 1.
- Produces: two panels shown under a selected season. No exports used elsewhere.

- [ ] **Step 1: Write StagesPanel**

Create `src/app/pages/admin/StagesPanel.tsx` with exactly:

```tsx
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface StageRow { id: string; name: string; starts_on: string; ends_on: string; tournament: string | null }
const EMPTY = { id: null as string | null, name: '', starts_on: '', ends_on: '', tournament: '' };

export function StagesPanel({ seasonId }: { seasonId: string }) {
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stages = useLoad(async () => {
    const { data, error } = await supabase!
      .from('stages').select('id, name, starts_on, ends_on, tournament').eq('season_id', seasonId).order('starts_on');
    if (error) throw error;
    return (data ?? []) as StageRow[];
  }, [seasonId]);

  async function run(action: () => Promise<string | void>) {
    setStatus(null);
    setError(null);
    try {
      const done = await action();
      if (done) setStatus(done);
      stages.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const t = form.tournament.trim() || null;
      if (form.id) await api.updateStage(form.id, form.name, form.starts_on, form.ends_on, t);
      else await api.createStage(seasonId, form.name, form.starts_on, form.ends_on, t);
      setForm(EMPTY);
    });
  }

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="card">
      <h2>Stages</h2>
      <p>
        Players see stages as "seasons". Grant a stage's allowance before its auction. Running it again only
        credits teams that joined since.
      </p>
      <ul className="list">
        {stages.data?.map((s) => (
          <li key={s.id}>
            <span>{s.name} · {s.starts_on} → {s.ends_on}{s.tournament ? ` · ends at ${s.tournament}` : ''}</span>
            <span className="row">
              <button className="linklike" onClick={() => setForm({ ...s, tournament: s.tournament ?? '' })}>Edit</button>
              <button onClick={() => void run(async () => `${s.name}: credited ${await api.grantStageAllowance(s.id)} teams.`)}>
                Grant allowance
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={save} className="row">
        <label>Name<input required value={form.name} onChange={set('name')} placeholder="Fall beta" /></label>
        <label>Starts<input type="date" required value={form.starts_on} onChange={set('starts_on')} /></label>
        <label>Ends<input type="date" required value={form.ends_on} onChange={set('ends_on')} /></label>
        <label>Ends at tournament<input value={form.tournament} onChange={set('tournament')} placeholder="optional" /></label>
        <button>{form.id ? 'Save stage' : 'Add stage'}</button>
        {form.id && <button type="button" className="secondary" onClick={() => setForm(EMPTY)}>Cancel</button>}
      </form>
      {status && <p>{status}</p>}
      {(error || stages.error) && <p className="error">{error ?? stages.error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Write WalletsPanel**

Create `src/app/pages/admin/WalletsPanel.tsx` with exactly:

```tsx
import { useState, type FormEvent } from 'react';
import { DEFAULT_SETTINGS } from '../../../core/settings';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { balance } from '../../lib/wallet';

interface LeagueRow {
  id: string;
  name: string;
  memberships: { id: string; team_name: string; credit_ledger: { amount: number }[] }[];
}
interface Team { id: string; label: string }

export function WalletsPanel({ seasonId }: { seasonId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = useLoad(async () => {
    const [season, leagues] = await Promise.all([
      supabase!.from('seasons').select('settings').eq('id', seasonId).single(),
      supabase!.from('leagues').select('id, name, memberships(id, team_name, credit_ledger(amount))')
        .eq('season_id', seasonId).order('name'),
    ]);
    if (season.error) throw season.error;
    if (leagues.error) throw leagues.error;
    const settings = season.data.settings as { donations_enabled?: unknown; credits_per_dollar?: unknown };
    return {
      donationsEnabled: settings.donations_enabled === true,
      creditsPerDollar: Number(settings.credits_per_dollar ?? DEFAULT_SETTINGS.credits_per_dollar),
      leagues: (leagues.data ?? []) as LeagueRow[],
    };
  }, [seasonId]);

  /** True when the action succeeded, so the form can clear itself. */
  async function run(action: () => Promise<string>): Promise<boolean> {
    setStatus(null);
    setError(null);
    try {
      setStatus(await action());
      data.reload();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  const teams: Team[] = (data.data?.leagues ?? []).flatMap((l) =>
    l.memberships.map((m) => ({ id: m.id, label: `${m.team_name} (${l.name})` })));

  return (
    <div className="card">
      <h2>Wallets</h2>
      {data.data?.leagues.map((l) => (
        <div key={l.id}>
          <h3>{l.name}</h3>
          <ul className="list">
            {l.memberships.map((m) => (
              <li key={m.id}><span>{m.team_name}</span><strong>{balance(m.credit_ledger)} credits</strong></li>
            ))}
          </ul>
        </div>
      ))}
      <CreditForm
        title="Adjust credits"
        help="Fixes a mistake. The ledger is never edited, so this adds a correcting entry. Use a negative number to take credits away."
        teams={teams}
        amountLabel="Credits (+/−)"
        step="1"
        onSubmit={(team, amount, note) => run(async () => {
          await api.adjustCredits(team.id, amount, note);
          return `Adjusted ${team.label} by ${amount}.`;
        })}
      />
      {data.data?.donationsEnabled && (
        <CreditForm
          title="Record a donation to the team"
          help={`Only after the treasurer has received the money through the official team channel. The app never
            holds or moves money. The donor gets ${data.data.creditsPerDollar} credits per dollar.`}
          teams={teams}
          amountLabel="Dollars donated to the team"
          step="0.01"
          onSubmit={(team, dollars, note) => run(async () => {
            await api.recordDonation(team.id, dollars, note);
            return `Recorded a $${dollars.toFixed(2)} donation to the team from ${team.label}.`;
          })}
        />
      )}
      {status && <p>{status}</p>}
      {(error || data.error) && <p className="error">{error ?? data.error}</p>}
    </div>
  );
}

function CreditForm({ title, help, teams, amountLabel, step, onSubmit }: {
  title: string;
  help: string;
  teams: Team[];
  amountLabel: string;
  step: string;
  onSubmit: (team: Team, amount: number, note: string) => Promise<boolean>;
}) {
  const [teamId, setTeamId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const team = teams.find((t) => t.id === teamId);
    if (!team) return;
    void onSubmit(team, Number(amount), note).then((ok) => { if (ok) { setAmount(''); setNote(''); } });
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>{title}</h3>
      <p className="muted">{help}</p>
      <div className="row">
        <label>Team
          <select required value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Choose…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label>{amountLabel}<input type="number" required step={step} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Note<input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button>Save</button>
      </div>
    </form>
  );
}
```

The donation form only renders when the season's `donations_enabled` is `true`, and its title, label and help text all say it is a **donation to the team** (spec §3). Keep that wording.

- [ ] **Step 3: Show them in the admin console**

Apply to `src/app/pages/admin/AdminPage.tsx`:

```diff
@@ -6,6 +6,8 @@ import { LeaguesPanel } from './LeaguesPanel';
 import { SeasonsPanel } from './SeasonsPanel';
 import { SettingsEditor } from './SettingsEditor';
 import { StaffPanel } from './StaffPanel';
+import { StagesPanel } from './StagesPanel';
+import { WalletsPanel } from './WalletsPanel';
 
 export function AdminPage() {
   const { isAdmin, loading } = useAuth();
@@ -20,7 +22,9 @@ export function AdminPage() {
       {seasonId && (
         <>
           <SettingsEditor key={seasonId} seasonId={seasonId} />
+          <StagesPanel key={seasonId} seasonId={seasonId} />
           <LeaguesPanel key={seasonId} seasonId={seasonId} />
+          <WalletsPanel key={seasonId} seasonId={seasonId} />
           <AthletesPanel key={seasonId} seasonId={seasonId} />
         </>
       )}
```

- [ ] **Step 4: Typecheck, lint, build**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx tsc && npx eslint . && npm run build`
Expected: no output from tsc/eslint; `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/admin/StagesPanel.tsx src/app/pages/admin/WalletsPanel.tsx src/app/pages/admin/AdminPage.tsx
git commit -m "feat(admin): stages panel with allowance grant; wallets with adjustments and team donations" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Wallet on the home page  (model: haiku)

**Files:**
- Modify: `src/app/pages/HomePage.tsx`

**Interfaces:**
- Consumes: `LEDGER_COLUMNS`, `LedgerEntry`, `balance`, `entryLabel` from Task 3. RLS (Task 2) limits the embedded `credit_ledger` to the user's own entries.

- [ ] **Step 1: Add the wallet card**

Apply to `src/app/pages/HomePage.tsx`:

```diff
@@ -2,11 +2,13 @@ import { Link } from 'react-router';
 import { useAuth } from '../auth/AuthProvider';
 import { supabase } from '../lib/supabase';
 import { useLoad } from '../lib/useLoad';
+import { balance, entryLabel, LEDGER_COLUMNS, type LedgerEntry } from '../lib/wallet';
 
 interface MembershipRow {
   id: string;
   team_name: string;
   leagues: { name: string; seasons: { name: string } | null } | null;
+  credit_ledger: LedgerEntry[];
 }
 
 export function HomePage() {
@@ -16,7 +18,7 @@ export function HomePage() {
     if (!supabase || !uid) return [] as MembershipRow[];
     const { data, error } = await supabase
       .from('memberships')
-      .select('id, team_name, leagues(name, seasons(name))')
+      .select(`id, team_name, leagues(name, seasons(name)), credit_ledger(${LEDGER_COLUMNS})`)
       .eq('user_id', uid);
     if (error) throw error;
     return (data ?? []) as unknown as MembershipRow[];
@@ -39,10 +41,32 @@ export function HomePage() {
       {data && data.length === 0 && <p>You're not in a league yet. <Link to="/join">Join with an invite code</Link>.</p>}
       <ul className="list">
         {data?.map((m) => (
-          <li key={m.id}><strong>{m.team_name}</strong> · {m.leagues?.name} ({m.leagues?.seasons?.name})</li>
+          <li key={m.id}>
+            <span><strong>{m.team_name}</strong> · {m.leagues?.name} ({m.leagues?.seasons?.name})</span>
+            <Wallet entries={m.credit_ledger} />
+          </li>
         ))}
       </ul>
       {data && data.length > 0 && <Link to="/join">Join another league</Link>}
     </section>
   );
 }
+
+function Wallet({ entries }: { entries: LedgerEntry[] }) {
+  const newestFirst = [...entries].sort((a, b) => b.id - a.id);
+  return (
+    <details>
+      <summary>{balance(entries)} credits</summary>
+      <ul>
+        {newestFirst.map((e) => (
+          <li key={e.id}>
+            {new Date(e.created_at).toLocaleDateString()} · {entryLabel(e)} · {e.amount > 0 ? '+' : ''}{e.amount}
+          </li>
+        ))}
+      </ul>
+      <p className="muted">
+        Credits are a thank-you for supporting the team. They have no cash value and can't be refunded.
+      </p>
+    </details>
+  );
+}
```

Each team shows its balance; opening it lists entries newest first (`Allowance — Fall beta · +115`, `Donation to the team — $12.50 · +250`) and says credits are a thank-you for supporting the team with no cash value.

- [ ] **Step 2: Typecheck, lint, test**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx tsc && npx eslint . && npx vitest run src/app`
Expected: clean; PASS (App.test.tsx still renders the signed-out home page).

- [ ] **Step 3: Commit**

```bash
git add src/app/pages/HomePage.tsx
git commit -m "feat(app): wallet card per team on the home page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: M3 follow-ups: tally queue, auth reset, old-season sessions  (model: sonnet)

**Files:**
- Modify: `src/app/tally/queue.ts`, `src/app/pages/TallyPage.tsx`, `src/app/auth/AuthProvider.tsx`
- Test: `src/app/tally/queue.test.ts`

**Interfaces:**
- Produces: `canForgetLocally(targetId, queue, inFlight, savedIds)` (new 4th parameter) and `unsavedTaps(sent, queue, savedIds): QueuedTap[]` in `queue.ts`. Only TallyPage calls them.

- [ ] **Step 1: Write the failing tests**

Apply to `src/app/tally/queue.test.ts`:

```diff
@@ -2,7 +2,8 @@
 import { beforeEach, describe, expect, it } from 'vitest';
 import type { Tap } from '../../core/taps';
 import {
-  canForgetLocally, isRejection, lastUndoable, loadQueue, queuedSessions, removeSent, storeQueue, type QueuedTap,
+  canForgetLocally, isRejection, lastUndoable, loadQueue, queuedSessions, removeSent, storeQueue, unsavedTaps,
+  type QueuedTap,
 } from './queue';
 
 const q = (id: string, undoes: string | null = null): QueuedTap => ({
@@ -85,18 +86,29 @@ describe('canForgetLocally', () => {
   it('returns true when queued and not in flight', () => {
     const queue = [q('a'), q('b')];
     const inFlight = new Set<string>();
-    expect(canForgetLocally('a', queue, inFlight)).toBe(true);
+    expect(canForgetLocally('a', queue, inFlight, new Set())).toBe(true);
   });
 
   it('returns false when queued but in flight', () => {
     const queue = [q('a'), q('b')];
     const inFlight = new Set(['a']);
-    expect(canForgetLocally('a', queue, inFlight)).toBe(false);
+    expect(canForgetLocally('a', queue, inFlight, new Set())).toBe(false);
   });
 
   it('returns false when not queued (already saved)', () => {
     const queue = [q('a'), q('b')];
     const inFlight = new Set<string>();
-    expect(canForgetLocally('c', queue, inFlight)).toBe(false);
+    expect(canForgetLocally('c', queue, inFlight, new Set())).toBe(false);
+  });
+});
+
+describe('saved taps still in a reopened queue', () => {
+  it('are not forgotten locally: undo must send a real undo', () => {
+    expect(canForgetLocally('a', [q('a')], new Set(), new Set(['a']))).toBe(false);
+  });
+
+  it('are not counted twice', () => {
+    expect(unsavedTaps([q('s')], [q('a'), q('b')], new Set(['a', 's'])).map((t) => t.id)).toEqual(['b']);
+    expect(unsavedTaps([q('s')], [q('a')], new Set()).map((t) => t.id)).toEqual(['s', 'a']);
   });
 });
```

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/app/tally`
Expected: FAIL: `unsavedTaps` is not exported; `canForgetLocally` ignores saved ids.

- [ ] **Step 3: Fix the queue helpers**

Apply to `src/app/tally/queue.ts`:

```diff
@@ -97,9 +97,19 @@ export const queuedToTap = (q: QueuedTap, keeperId: string): Tap => ({
   undoes: q.undoes,
 });
 
-/** Tap can be forgotten locally only if it's queued and not currently being sent to the server. */
-export function canForgetLocally(targetId: string, queue: QueuedTap[], inFlight: ReadonlySet<string>): boolean {
-  return queue.some((q) => q.id === targetId) && !inFlight.has(targetId);
+/**
+ * Tap can be forgotten locally only if it's queued, not being sent, and not already on the server
+ * (a reopened board can still hold a queued copy of a tap an earlier board saved).
+ */
+export function canForgetLocally(
+  targetId: string, queue: QueuedTap[], inFlight: ReadonlySet<string>, savedIds: ReadonlySet<string>,
+): boolean {
+  return queue.some((q) => q.id === targetId) && !inFlight.has(targetId) && !savedIds.has(targetId);
+}
+
+/** Taps the server doesn't have yet, in tap order: sent batches (older) then the queue. */
+export function unsavedTaps(sent: QueuedTap[], queue: QueuedTap[], savedIds: ReadonlySet<string>): QueuedTap[] {
+  return [...sent, ...queue].filter((t) => !savedIds.has(t.id));
 }
 
 /** The keeper's newest tap that is neither an undo nor already undone, for "Undo last tap". */
```

- [ ] **Step 4: Use them in the tally board, and load athletes from the session's own season**

Apply to `src/app/pages/TallyPage.tsx`:

```diff
@@ -12,7 +12,7 @@ import { supabase } from '../lib/supabase';
 import { useLoad } from '../lib/useLoad';
 import {
   BATCH_MAX, canForgetLocally, isRejection, lastUndoable, loadQueue, queuedSessions, queuedToTap, removeSent, rowToTap,
-  storeQueue,
+  storeQueue, unsavedTaps,
   type QueuedTap, type StatTapRow,
 } from '../tally/queue';
 
@@ -117,14 +117,17 @@ function TallyBoard({ season, sessionId, keeperId, onBack }: {
   const inFlight = useRef<Set<string>>(new Set());
 
   const data = useLoad(async () => {
-    const [sess, athletes, taps, attendance, injuries] = await Promise.all([
-      supabase!.from('sessions').select(SESSION_COLUMNS).eq('id', sessionId).single(),
-      supabase!.from('athletes').select('id, name').eq('season_id', season.id).eq('opted_in', true).order('name'),
+    const sess = await supabase!.from('sessions').select(SESSION_COLUMNS).eq('id', sessionId).single();
+    if (sess.error) throw sess.error;
+    // The session's own season: a queued session from an earlier season must show that season's athletes.
+    const seasonId = (sess.data as SessionRow).season_id;
+    const [athletes, taps, attendance, injuries] = await Promise.all([
+      supabase!.from('athletes').select('id, name').eq('season_id', seasonId).eq('opted_in', true).order('name'),
       supabase!.from('stat_taps').select('id, athlete_id, stat, keeper_id, tapped_at, undoes').eq('session_id', sessionId),
       supabase!.from('attendance').select('athlete_id, status').eq('session_id', sessionId),
       supabase!.from('injuries').select('id, athlete_id, confirmed_at').is('cleared_at', null),
     ]);
-    for (const r of [sess, athletes, taps, attendance, injuries]) if (r.error) throw r.error;
+    for (const r of [athletes, taps, attendance, injuries]) if (r.error) throw r.error;
     return {
       session: sess.data as SessionRow,
       athletes: (athletes.data ?? []) as AthleteRow[],
@@ -132,7 +135,7 @@ function TallyBoard({ season, sessionId, keeperId, onBack }: {
       attendance: (attendance.data ?? []) as AttendanceRow[],
       injuries: (injuries.data ?? []) as InjuryRow[],
     };
-  }, [sessionId, season.id]);
+  }, [sessionId]);
   const reload = data.reload;
 
   useEffect(() => {
@@ -188,11 +191,11 @@ function TallyBoard({ season, sessionId, keeperId, onBack }: {
   }, [flush]);
 
   const saved = useMemo(() => (data.data?.taps ?? []).map(rowToTap), [data.data]);
-  const queued = useMemo(() => {
-    const savedIds = new Set(saved.map((t) => t.id));
-    // Sent taps are older than queued ones, so this stays in tap order.
-    return [...sent.filter((t) => !savedIds.has(t.id)), ...queue].map((q) => queuedToTap(q, keeperId));
-  }, [saved, sent, queue, keeperId]);
+  const savedIds = useMemo(() => new Set(saved.map((t) => t.id)), [saved]);
+  const queued = useMemo(
+    () => unsavedTaps(sent, queue, savedIds).map((q) => queuedToTap(q, keeperId)),
+    [savedIds, sent, queue, keeperId],
+  );
   // Display only: queued times aren't skew-corrected yet. Verify recomputes from the server's taps.
   const counts = useMemo(
     () => mergeTaps([...saved, ...queued], season.settings.tap_merge_seconds).counts,
@@ -214,7 +217,7 @@ function TallyBoard({ season, sessionId, keeperId, onBack }: {
   function undo() {
     const target = lastUndoable(saved, queued, keeperId);
     if (!target) return;
-    if (canForgetLocally(target.id, queue, inFlight.current)) {
+    if (canForgetLocally(target.id, queue, inFlight.current, savedIds)) {
       setQueue((q) => q.filter((t) => t.id !== target.id)); // never sent: just forget it
     } else {
       setQueue((q) => [...q, {
```

Follow-up 1: a reopened board can hold a queued copy of a tap an earlier board already saved (the save landed but clearing storage didn't). Those taps are no longer counted twice, and "Undo last tap" sends a real undo for them instead of forgetting a tap the server keeps. Follow-up 3: the board reads the session first and loads that season's athletes, so a queued session from an old season shows the right roster.

- [ ] **Step 5: Reset auth state when the user changes**

Apply to `src/app/auth/AuthProvider.tsx`:

```diff
@@ -1,4 +1,4 @@
-import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
+import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
 import type { Session } from '@supabase/supabase-js';
 import { supabase } from '../lib/supabase';
 import { readAuthRedirectError } from './authRedirectError';
@@ -23,15 +23,18 @@ export function AuthProvider({ children }: { children: ReactNode }) {
   const [isAdmin, setIsAdmin] = useState(false);
   const [isKeeper, setIsKeeper] = useState(false);
   const [authError, setAuthError] = useState<string | null>(null);
+  const loadedFor = useRef<string | null>(null);
 
   const loadProfile = useCallback(async (s: Session | null) => {
-    if (!supabase || !s) {
+    const uid = s?.user.id ?? null;
+    if (loadedFor.current !== uid) {
+      // A different user (or none): drop the last user's name and roles before a fetch that might fail.
+      loadedFor.current = uid;
       setDisplayName(null);
       setIsAdmin(false);
       setIsKeeper(false);
-      return;
     }
-    const uid = s.user.id;
+    if (!supabase || !s || !uid) return;
     const [profile, roles] = await Promise.all([
       supabase.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
       supabase.from('user_roles').select('role').eq('user_id', uid),
```

Follow-up 2: on a shared phone, signing out and in as someone else must never keep showing the previous user's name or admin/keeper roles, even if the new user's profile fetch fails. A failed fetch for the *same* user still keeps what we knew (the M3 behavior: an hourly token refresh mustn't drop a keeper out of tallying).

- [ ] **Step 6: Run everything**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run && npx tsc && npx eslint .`
Expected: all PASS (191 tests); tsc/eslint clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/tally/queue.ts src/app/tally/queue.test.ts src/app/pages/TallyPage.tsx src/app/auth/AuthProvider.tsx
git commit -m "fix(tally,auth): M3 follow-ups: no double count or lost undo on reopened boards, reset roles on user switch, old-season sessions" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Go-live steps and gates  (model: haiku)

**Files:**
- Modify: `docs/setup-supabase.md`, `docs/superpowers/plans/2026-09-25-m1-m2-foundation-and-core.md`

**Interfaces:**
- Consumes: everything above. Produces: the user's paste-and-configure steps and the M5/M6 gates.

- [ ] **Step 1: Write the go-live steps**

Apply to `docs/setup-supabase.md`:

```diff
@@ -37,3 +37,12 @@
    sessions impossible to verify.
 3. Coaches: have each sign in and set a name, then **Admin → Stat keepers → Make keeper**. Don't make coaches admins.
 4. Players: **Admin → Athletes → linked account** for each player who wants to mark attendance/injuries.
+
+## M4 stages and wallet (after 0001–0005)
+
+1. SQL Editor: paste and run `supabase/migrations/0006_stages_wallet.sql`. It also removes the retired
+   `min_credits_to_play`, `free_entry` and `extra_credit_cap` keys from saved season settings.
+2. In **Admin → season → Settings**, check `roster_size` (4 for 6 × 4 leagues, 3 for 8 × 3) and `max_members` (6 or 8).
+   Leave `donations_enabled` false until the legal sign-off.
+3. **Admin → season → Stages**: add the fall beta stage (Oct 18 – Nov 8, ends at the Nov 7–8 tournament). After
+   everyone has joined, press **Grant allowance**. Press it again for anyone who joins later.
```

- [ ] **Step 2: Carry the gates to M5 and M6**

Apply to `docs/superpowers/plans/2026-09-25-m1-m2-foundation-and-core.md`:

```diff
@@ -3550,4 +3550,8 @@ Taskboard: t14 → `done`, t15 → `done` (note: "Magic link + 6-digit code; inv
   - compare `placed_at` as normalized integer µs (Date.parse drops µs and returns NaN on bad input);
   - enforce `allow_self_ownership` in `fillLeftovers`.
 - **M6:** a missing `acquiredWeek` must throw instead of defaulting to multiplier 1; the caller pushes `absent_score` into default-pick history for weeks without stat lines.
+- **M5 (wallet, from M4):** add `bid` to the `credit_ledger.kind` check and a SQL `balance(membership)` helper;
+  adjustments can leave a balance negative, so bidding must refuse (`INSUFFICIENT_CREDITS`) rather than assume ≥ 0.
+- **M6 (allowance, from M4):** replace the `private.standings_points()` stub (always 0 in 0006) with real standings
+  points, and add a `grant_stage_allowance` test on real standings.
 - **Every new migration:** add an explicit `grant select ... to authenticated` next to its policies (default privileges are revoked), re-run the function grant loop, and keep extensions out of `public`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/setup-supabase.md docs/superpowers/plans/2026-09-25-m1-m2-foundation-and-core.md
git commit -m "docs: M4 go-live steps; M5/M6 gates for bids and standings" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
