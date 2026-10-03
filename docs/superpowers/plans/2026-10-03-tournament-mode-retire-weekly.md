# Tournament mode T4: retire weekly play — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Invoke `ponytail:ponytail` before writing code.

**Goal:** Remove every trace of weekly play (tables, RPCs, settings keys, core code), retire practice tallying, call
stages "tournaments" everywhere, and fix the League tab losing its standings between tournaments.

**Architecture:** One migration (`0013_retire_weekly.sql`) drops the weekly schema and strips the retired settings
keys; the core loses `year.ts` / `roundRobin` / the no-repeat cycle and keeps its shared types in `tournament.ts`;
the app's Tally page lists game sessions only, and the League tab always renders standings. Copy is a find-and-fix
sweep; code and DB names keep `stage`.

**Tech Stack:** Vite + React + TS, Supabase (Postgres RPCs), vitest + PGlite DB tests.

**Spec:** `docs/superpowers/specs/2026-10-02-tournament-mode-design.md` — §8 and amendments 8, 9, 14, **15** (T4
decisions, 2026-10-03).

**Verified draft:** local branch `t4-verified-draft` (c62d91f) holds the full working build: 202 app/core + 156 DB
tests, tsc, lint, build green. Each task names its files; executors copy them with
`git checkout t4-verified-draft -- <file>` (deletions: `git rm <file>`), read the diff, run the task's checks, and
commit. Don't retype code. If a check fails, fix it in the task and note the ruling.

## Global Constraints

- Node is not on the Bash PATH: `export PATH="/c/Program Files/nodejs:$PATH"` first.
- Run DB tests alone (`npx vitest run tests/db`): they time out next to a dev server or other agents.
- Names in code and the DB stay `stage`/`stages`/`StagesPanel`; only text people read changes.
- The league year is "season" (admin Seasons tab unchanged); a stage is a "tournament" to everyone.
- `create_session` stays in SQL (DB tests build sessions with it). Only the app's New session form goes.
- No tally-screen visual changes on tourney days; this ships AFTER the Oct 17–18 dry run.
- `parseSettings` rejects unknown keys, so `0013` must be pasted into the live DB BEFORE the T4 build deploys.
- New UI follows DESIGN.md and `src/app/tokens.css` (no new styles are needed here).

## Review Focus

1. **Stored settings still holding `pick_lock_day` / `pick_lock_time` / `usage_reset`.** The new build throws on
   them, so the live site breaks if 0013 isn't pasted first. Pinned by Task 1 (parseSettings rejects them) and
   Task 2 (0013 strips them, keeps other keys).
2. **A phone holding unsaved taps for an old practice session.** Hiding non-game sessions must not strand those
   taps. Pinned by Task 3 ("still lists a practice session this phone holds unsaved taps for").
3. **Between tournaments** (last day past, or the next auction not run): standings must still show, with no pick
   block and no Start game. Pinned by Task 3 (card test + loader `ends_on` test).
4. **Deleting an athlete that's in a bench swap or a game pick.** A plain delete must refuse; a forced one must
   count and cascade them. Pinned by Task 2 (rpc-qol tests).
5. **A game still live after midnight on the tournament's last day.** Start game and the pick block disappear,
   but the open game stays in the Tally list and its stats verify and score normally (a locked session is final
   whether or not Finish was tapped). No new test: covered by the existing scorer tests; check it in the Task 5
   visual pass if a throwaway tournament is handy.

---

### Task 1: Core — retire weekly code

**Files:**
- Delete: `src/core/year.ts`, `src/core/year.test.ts`, `src/core/schedule.ts`, `src/core/schedule.test.ts`
- Modify: `src/core/tournament.ts` (types moved in; `settleGame` + `standingsOf` helpers), `src/core/swiss.ts`
  (owns `Pairing`), `src/core/picks.ts` + `picks.test.ts` (no-repeat cycle gone), `src/core/settings.ts` +
  `settings.test.ts` (keys retired), `src/core/index.ts`, `src/core/simulate.ts`, `src/core/tournament.test.ts`,
  `src/app/lib/backup.ts` (type import only — line 1)

**Interfaces:**
- Produces: `YearMember`, `YearStatLine`, `YearInjury`, `YearStanding` exported from `src/core/tournament.ts`
  (same shapes as before); `Pairing` exported from `src/core/swiss.ts`. `SeasonSettings` no longer has
  `pick_lock_day`, `pick_lock_time`, `usage_reset`; `PICK_LOCK_DAYS` / `PickLockDay` are gone.
- `picks.ts` keeps only `defaultPick` and `autoPick`.

- [ ] **Step 1: Copy the settings test and see it fail**

```bash
git checkout t4-verified-draft -- src/core/settings.test.ts
npx vitest run src/core/settings.test.ts
```
Expected: FAIL — "rejects the weekly settings retired by tournament mode" (the keys are still accepted).

The new test:
```ts
  it('rejects the weekly settings retired by tournament mode (T4; 0013 strips them from stored seasons)', () => {
    for (const key of ['pick_lock_day', 'pick_lock_time', 'usage_reset']) {
      expect(() => parseSettings({ [key]: 'mon' })).toThrow(`unknown setting "${key}"`);
    }
  });
```

- [ ] **Step 2: Copy the core changes**

```bash
git rm -q src/core/year.ts src/core/year.test.ts src/core/schedule.ts src/core/schedule.test.ts
git checkout t4-verified-draft -- src/core/settings.ts src/core/picks.ts src/core/picks.test.ts src/core/index.ts \
  src/core/swiss.ts src/core/tournament.ts src/core/simulate.ts src/core/tournament.test.ts
```
Then in `src/app/lib/backup.ts` change ONLY line 1 to
`import type { YearStanding } from '../../core/tournament';` (the rest of that file is Task 3).

Read the `tournament.ts` diff: the final-game block becomes `settleGame(g, pairings, sides, lines, members, table, s)`
and the standings block becomes `standingsOf(table)`, both module-level, behaviour unchanged.

- [ ] **Step 3: Check**

```bash
npx tsc -b && npx eslint src/core scripts && npx vitest run src/core
```
Expected: tsc/lint clean (tsconfig includes `scripts/`, so `tune.ts` is typechecked), 110 core tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A src/core src/app/lib/backup.ts
git commit -m "refactor(core): retire weekly scoring, round robin and pick cycles (tournament mode T4)"
```

---

### Task 2: DB — migration 0013

**Files:**
- Create: `supabase/migrations/0013_retire_weekly.sql`
- Delete: `tests/db/rpc-weekly.test.ts`
- Modify: `tests/db/rpc-qol.test.ts` (game picks / bench swaps instead of weekly picks; 0013 migration test),
  `tests/db/rpc-gate.test.ts` (weekly RPCs out of the lists and steps)

**Interfaces:**
- Produces: no `weeks`/`picks` tables, no `create_stage_weeks`/`set_week_lock`/`set_pick`;
  `delete_athlete(p_athlete uuid, p_force boolean default false)` (same signature as 0011) whose forced audit
  details now carry `picks` (game picks) and `swaps` counts.

- [ ] **Step 1: Copy the tests and see them fail**

```bash
git rm -q tests/db/rpc-weekly.test.ts
git checkout t4-verified-draft -- tests/db/rpc-qol.test.ts tests/db/rpc-gate.test.ts
npx vitest run tests/db/rpc-qol.test.ts tests/db/rpc-gate.test.ts
```
Expected: FAIL — rpc-qol's "game pick or a bench swap" (0011 doesn't check them), the forced-delete `swaps` count,
the `0013 retire weekly` test (file missing); rpc-gate finds uncovered weekly RPCs.

- [ ] **Step 2: Copy the migration and read it**

```bash
git checkout t4-verified-draft -- supabase/migrations/0013_retire_weekly.sql
```
It: drops the three weekly functions, then `picks`, then `weeks`; runs
`update public.seasons set settings = settings - array['pick_lock_day', 'pick_lock_time', 'usage_reset'];`;
and `create or replace`s `delete_athlete` as 0011 with `public.game_picks` in place of `public.picks` and
`exists (select 1 from public.bench_swaps where p_athlete in (out_athlete, in_athlete))` in the in-use check, plus
`'swaps'` in the forced counts. `create or replace` keeps the grants, so no grant loop.

- [ ] **Step 3: Check (DB tests alone)**

```bash
npx vitest run tests/db
```
Expected: 15 files, 156 tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A supabase tests/db
git commit -m "feat(db): 0013 drops weekly play, strips retired settings, delete_athlete counts game picks and swaps (tournament mode T4)"
```

---

### Task 3: App — tournament-only tally, standings between tournaments

**Files:**
- Modify: `src/app/pages/TallyPage.tsx` + `TallyPage.test.tsx`, `src/app/pages/TournamentCard.tsx` +
  `TournamentCard.test.tsx`, `src/app/lib/tournament.ts` + `tournament.test.ts`, `src/app/lib/auction.ts` +
  `auction.test.ts`, `src/app/pages/AuctionCard.test.tsx` (fixture `ends_on` only), `src/app/lib/backup.ts` +
  `backup.test.ts`, `src/app/lib/errors.ts`, `src/app/lib/rpc.ts`

**Interfaces:**
- Consumes: Task 1 types; Task 2's dropped tables (Backup must not list them).
- Produces: `AuctionStage.ends_on: string` (in `AUCTION_STAGE_COLUMNS`); `loadCurrentGame(seasonId, now = Date.now())`;
  `api.createSession` removed.

Copy the WHOLE files listed above: `errors.ts`, `TournamentCard.tsx` and `backup.ts` also carry their Task 4 copy
changes, which is fine (Task 4 covers the remaining files and the leftover sweep).

- [ ] **Step 1: Copy the tests and see them fail**

```bash
git checkout t4-verified-draft -- src/app/pages/TallyPage.test.tsx src/app/pages/TournamentCard.test.tsx \
  src/app/lib/tournament.test.ts src/app/lib/backup.test.ts src/app/lib/auction.test.ts src/app/pages/AuctionCard.test.tsx
npx vitest run src/app
```
Expected FAILs: TallyPage "lists open tournament games only…" (practice session and New session still shown);
TournamentCard "keeps showing the standings between tournaments" (card returns null) and the `Pick Alex` /
`Bench Alex` names; tournament.test "last day has passed"; backup "create and keep" (weeks/picks still listed) and
the `tournament` CSV header. tsc may also flag `ends_on` in fixtures — that's expected until Step 2.

- [ ] **Step 2: Copy the implementation**

```bash
git checkout t4-verified-draft -- src/app/pages/TallyPage.tsx src/app/pages/TournamentCard.tsx src/app/lib/tournament.ts \
  src/app/lib/auction.ts src/app/lib/backup.ts src/app/lib/errors.ts src/app/lib/rpc.ts
```
Read the diffs. The core of it:

```ts
// src/app/lib/tournament.ts
/** The stage picks and Start game are for: its auction has run and its last day hasn't passed. Else none. */
function playingStage(stages: AuctionStage[], now: number): AuctionStage | null {
  const s = pickAuctionStage(stages);
  return s?.auction_run_at && todayLocal(new Date(now)) <= s.ends_on ? s : null;
}
// toTournamentInput:  currentStageId: playingStage(rows.stages, now)?.id ?? null,
// loadCurrentGame:    const stage = playingStage(<stages>, now); if (!stage) return null;
```
```tsx
// TournamentCard: the early `return null` when there are no games and no `next` is gone; Pick/Bench buttons get
// aria-label={`Pick ${name(id)}`} / aria-label={`Bench ${name(id)}`}.
// TallyPage SessionPicker: no New session form, no Delete; heading "Open games";
//   rows.filter((s) => game.has(s.id) || unsaved.has(s.id))
```
`errors.ts` loses `WEEKS_HAVE_PICKS` and `INVALID_LOCK_TIME` (and carries Task 4's copy); `rpc.ts` loses
`createSession`; `backup.ts` drops `weeks`/`picks` from `BACKUP_TABLES` and names the ledger CSV column
`tournament`.

- [ ] **Step 3: Check**

```bash
npx tsc -b && npx eslint . && npx vitest run src
```
Expected: clean; 34 files / 202 tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A src
git commit -m "feat(app): tally lists tournament games only; standings show between tournaments (tournament mode T4)"
```

---

### Task 4: Copy — stages are "tournaments", the year is the "season"

**Files:**
- Modify: `src/app/pages/RulesPage.tsx`, `src/app/pages/AuctionCard.tsx`, `src/app/pages/admin/AdminPage.tsx`,
  `src/app/pages/admin/StagesPanel.tsx`, `src/app/lib/wallet.ts`, `docs/frontend-principles.md`, `PRODUCT.md`
  (Task 3 already brought the copy in `errors.ts`, `TournamentCard.tsx`, `backup.ts`.)

- [ ] **Step 1: Copy and read**

```bash
git checkout t4-verified-draft -- src/app/pages/RulesPage.tsx src/app/pages/AuctionCard.tsx src/app/pages/admin/AdminPage.tsx \
  src/app/pages/admin/StagesPanel.tsx src/app/lib/wallet.ts docs/frontend-principles.md PRODUCT.md
```
Rules: "The season" card ("the season is split into tournaments"), every per-stage "season" → "tournament"
(allowance, rosters, short rosters, bench swap, tiredness table, the decay card). Admin: tab "Tournaments", panel
heading/buttons/empty state say tournament, the old "Players see stages as seasons" line is replaced, the
`tournament` text field is labelled "Event" and shown as "· at {event}".

- [ ] **Step 2: Sweep for leftovers**

```bash
grep -rnE "(['\"\`>][^'\"\`<]*\b[Ss]tages?\b)|\bseasons?\b" src/app --include=*.tsx --include=*.ts | grep -v "\.test\." | grep -vE "stage_id|stageId|from\('stages'\)|seasonId|season_id|season\.|SeasonSettings"
```
Every hit left must be code (identifiers, column lists, comments) or mean the YEAR (Seasons tab, season settings,
"No season yet"). Fix any player-visible stage-meaning word.

- [ ] **Step 3: Check**

```bash
npx tsc -b && npx eslint . && npx vitest run src && npm run build
```
Expected: clean, 202 tests, build OK.

- [ ] **Step 4: Commit**

```bash
git add -A src docs PRODUCT.md
git commit -m "docs(app): stages are tournaments to everyone, the year is the season (tournament mode T4)"
```

---

### Task 5 (controller): verify, go live after Oct 18

- [ ] Full checks: `npx tsc -b && npx eslint . && npx vitest run src && npm run build`, then `npx vitest run tests/db`
  alone. Expected 202 + 156.
- [ ] `git diff t4-verified-draft` is empty apart from this plan (or each difference has a recorded ruling).
- [ ] Visual check in the preview (launch.json "tribe-fantasy", user signs in once): League tab shows standings
  with no tournament running; Tally shows "Open games" and no New session form; Rules reads "tournaments";
  Admin → Tournaments tab. Phone width (375×812) for Tally and League.
- [ ] Final opus review of the branch.
- [ ] GO-LIVE (after the Oct 17–18 dry run, user OK each step): (1) user takes a Backup JSON if they want the
  weekly test data; (2) nobody saves season settings on the old build from here on; (3) user pastes **0013**
  into tribe-dev; anon probe: `set_pick` gone (PGRST202), `delete_athlete` still 42501 for anon; (4) merge to
  main, push, CI + Deploy green, live bundle has the change; (5) tag `m9-t4`; (6) board t84 done; (7) delete
  `t4-verified-draft`; (8) `graphify update .`.
