# M8 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app safe, backed up and understandable before the fall beta: the security fixes from the
audit, an admin backup/export tab, a public rules page, mobile and M5/M6 polish, a year simulator with a tuning
sweep, and an end-to-end dry run on the real migrations.

**Architecture:** No new subsystems. One additive migration (`0009_hardening.sql`, which only does `create or
replace` on four functions), two new pages (`#/rules`, public; Admin → Backup), `simulateYear` in `src/core`, which
builds `YearInput` rows and scores them with the real `scoreYear`, plus a PGlite dry-run test that drives every
RPC from allowance to scoring.

**Tech Stack:** TypeScript, React 19, Vite, Supabase (Postgres RLS + security-definer RPCs), Vitest, PGlite for DB tests.

**Spec:** `docs/superpowers/specs/2026-09-27-m8-hardening-design.md`. Read it first, **including "Amendments from
the verified build" at the end**, which overrides the sections above it where they differ.

## Global Constraints

- Every executor invokes `ponytail:ponytail` first (the user's standing rule): shortest correct diff, no new deps.
- node/npm are not on the Bash PATH: prefix commands with `export PATH="/c/Program Files/nodejs:$PATH";`.
- UI follows `DESIGN.md` and uses only tokens from `src/app/tokens.css` (no new colours). Gold means act; pills
  carry words; 44px targets; the phone edge-to-edge `@media` block stays LAST in `styles.css`.
- All writes go through security-definer RPCs with `set search_path = ''`. Never edit an applied migration (0001–0008).
- The UI says a donation is a **donation to the team fund**; credits have **no cash value**; the prize is **merch**.
- Rules-page numbers come from `DEFAULT_SETTINGS` (`src/core/settings.ts`), computed at render, never typed in.
- Error codes used: `PICK_LOCKED`, `OWNS_ATHLETE`, `NOT_FOUND`, `NOT_ON_ROSTER`, `INVALID_LOCK_TIME`.
- DB tests time out when run alongside the dev server or other agents: run `npx vitest run tests/db` on its own.
- `0009` is additive and safe to paste before or after the deploy. The live DB (tribe-dev) now has a stage with
  weeks: don't put test data in it.

## The verified draft

The full implementation was built and verified while planning: tsc, lint, build, **153 app/core tests + 137 DB
tests** green, and the Rules page and Backup tab were checked at 375px in the preview. `loadBackup` read all 19
tables from the live DB. It lives in `git stash` **"m8-verified-draft"** on branch `m8-hardening` (base `af60269`).
Executors copy their task's files from it instead of retyping, then run the task's checks. In every task:

```bash
S=$(git stash list | grep m8-verified-draft | cut -d: -f1)   # e.g. stash@{0}
git checkout "$S" -- <modified tracked file>                 # files that already exist on the branch
git checkout "$S^3" -- <new file>                            # files the draft creates (untracked in the stash)
```

Never `git stash pop`/`apply` the whole stash, and never copy `.impeccable/` or `tsconfig.tsbuildinfo`. Two files
are shared between tasks and are hand-edited in the earlier task: `src/app/styles.css` and `DESIGN.md` (Task 3 adds
one line to each; Task 4 copies the whole file). Reviewers compare each task's diff against the spec, not against
the stash.

## Review Focus

Inputs the spec implies that are most likely to bite real users. Each has a test in the owning task:

1. **A stage's closing tournament is verified after the next stage's auction has run.** The old owner must still
   be blocked. The tally screen must grey out at least every athlete the server would refuse, because one refused
   tap drops its whole batch → owner-gates "still counts last stage's owner" + `ownershipStages` test (Task 1).
2. **An admin who is also a manager moves a passed pick lock** → `PICK_LOCKED` (Task 1). The existing lock tests
   were calendar-dependent (a fixed Oct 2026 lock) and are now pinned relative to `now()`, or they would start
   failing on Oct 20, 2026.
3. **A backup when a table has more than 1000 rows** (the audit log will): `loadBackup` pages every table with a
   unique order. The test also fails if a migration adds a table that `BACKUP_TABLES` misses (Task 2).
4. **A manager types 0, a decimal or less than `min_bid`**: the bid input refuses it client-side with "Bid at least
   N, in whole credits." instead of a server error (Task 4; covered by review and the preview check).
5. **The rules page drifting from the code**: every number is computed from `DEFAULT_SETTINGS` and the core
   functions, and `RulesPage.test.tsx` pins the allowance, the worked example, the lock time and the upset row
   (Task 3). The Task 5 tuning change updates it.

---

### Task 1: Security — migration 0009, guards, DB test gaps, bundle check

Model: **sonnet** (DB). Reviewer: **opus** (security).

**Files:**
- Create: `supabase/migrations/0009_hardening.sql`
- Modify: `tests/db/guards.test.ts` (private schema unreachable; every security definer pins `search_path`),
  `tests/db/owner-gates.test.ts` (`own()` takes a stage, `stageAt()` helper, three new tests),
  `tests/db/rpc-auction.test.ts` (owns_athlete follows the 7-day window),
  `tests/db/rpc-gate.test.ts` (set_week_lock step moves the lock to now + 1 h first),
  `tests/db/rpc-weekly.test.ts` (calendar-proof set_week_lock test with audit old/new, passed-lock refusal,
  `NOT_FOUND` for create_stage_weeks and set_week_lock, a cross-season `set_pick` → `NOT_ON_ROSTER`),
  `src/app/lib/auction.ts` (`ownershipStages`, `loadOwnedAthletes` with 2 round trips),
  `src/app/lib/auction.test.ts`, `.github/workflows/deploy.yml` (bundle secret check)

**Interfaces:**
- Produces: `ownershipStages(stages: { id: string; starts_on: string; ends_on: string }[], today: string): string[]`;
  `loadOwnedAthletes(userId: string, seasonId: string, today = todayLocal()): Promise<Set<string>>` (same call
  sites as before).

- [ ] **Step 1: Copy the tests**

```bash
S=$(git stash list | grep m8-verified-draft | cut -d: -f1)
git checkout "$S" -- tests/db/guards.test.ts tests/db/owner-gates.test.ts tests/db/rpc-auction.test.ts \
  tests/db/rpc-gate.test.ts tests/db/rpc-weekly.test.ts src/app/lib/auction.test.ts
```

- [ ] **Step 2: Run them and watch the new ones fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run tests/db/owner-gates.test.ts tests/db/rpc-weekly.test.ts tests/db/rpc-auction.test.ts src/app/lib/auction.test.ts`
Expected: FAIL on "still counts last stage's owner…", "a keeper who is the injured player…", "won't move a
lock that has passed…", the owns_athlete window assertions, and `ownershipStages` (not exported).

- [ ] **Step 3: Copy the migration, client and workflow**

```bash
git checkout "$S^3" -- supabase/migrations/0009_hardening.sql
git checkout "$S" -- src/app/lib/auction.ts .github/workflows/deploy.yml
```

The migration, for review:

```sql
-- set_week_lock: after `if not found then raise exception 'NOT_FOUND'; end if;`
  if old <= now() then raise exception 'PICK_LOCKED'; end if;

-- owns_athlete: latest auctioned stage OR any auctioned stage that ended in the last 7 days
    where m.user_id = p_user and r.athlete_id = p_athlete and s.auction_run_at is not null
      and (s.ends_on >= current_date - 7 or s.id = (
        select s2.id from public.stages s2 join public.athletes a on a.season_id = s2.season_id
        where a.id = p_athlete and s2.auction_run_at is not null
        order by s2.starts_on desc limit 1)))

-- report_injury: auto-confirm only when the keeper neither owns nor IS the athlete
  auto := public.is_keeper() and not private.owns_athlete(uid, p_athlete) and not public.is_my_athlete(p_athlete);
-- confirm_injury
  if private.owns_athlete(uid, i.athlete_id) or public.is_my_athlete(i.athlete_id) then raise exception 'OWNS_ATHLETE'; end if;
```

The client mirror (`ownershipStages`) uses an 8-day window: one day wider than the DB, so the tally screen greys
out at least every athlete the server refuses. The deploy step:

```yaml
      - name: No secret keys in the bundle
        run: "! grep -rlE 'sb_secret_|service_role|c2VydmljZV9yb2xl|NlcnZpY2Vfcm9sZ|zZXJ2aWNlX3JvbG' dist"
```

- [ ] **Step 4: Run the checks**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run tests/db` alone, then
`npx vitest run src && npx tsc && npx eslint . && npm run build && ! grep -rlE 'sb_secret_|service_role|c2VydmljZV9yb2xl|NlcnZpY2Vfcm9sZ|zZXJ2aWNlX3JvbG' dist`
Expected: all DB tests PASS (132 without the dry run, which is Task 6); app tests PASS; build succeeds; grep finds nothing.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0009_hardening.sql tests/db src/app/lib/auction.ts src/app/lib/auction.test.ts .github/workflows/deploy.yml
git commit -m "fix(db): M8 security pass — passed locks stay locked, owner gate covers a stage's closing week, no self-confirmed injuries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Admin → Backup

Model: **haiku** (copy + verify). Reviewer: sonnet.

**Files:**
- Create: `src/app/lib/backup.ts`, `src/app/lib/backup.test.ts`, `src/app/pages/admin/BackupPanel.tsx`
- Modify: `src/app/pages/admin/AdminPage.tsx` (import `BackupPanel`; `['backup', 'Backup']` last in `TABS`;
  `{tab === 'backup' && <BackupPanel seasonId={seasonId} />}`)

**Interfaces:**
- Consumes: `fetchAll`, `loadLeagueYear`, `LeagueYear` (`src/app/lib/weekly.ts`); `toCsv`, `downloadText`,
  `todayLocal` (`src/app/lib/stats.ts`).
- Produces: `BACKUP_TABLES: Record<string, string[]>` (table → unique order keys); `loadBackup(now?): Promise<{ exportedAt: string; tables: Record<string, unknown[]> }>`;
  `ledgerRows(leagues: LedgerLeague[])`; `standingsRows(leagues: { name: string; year: LeagueYear }[])`.

- [ ] **Step 1: Copy the test and watch it fail**

```bash
S=$(git stash list | grep m8-verified-draft | cut -d: -f1)
git checkout "$S^3" -- src/app/lib/backup.test.ts
```

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/app/lib/backup.test.ts`
Expected: FAIL — `./backup` not found.

- [ ] **Step 2: Copy the implementation**

```bash
git checkout "$S^3" -- src/app/lib/backup.ts src/app/pages/admin/BackupPanel.tsx
git checkout "$S" -- src/app/pages/admin/AdminPage.tsx
```

Reviewer checks:
- The backup is every table, ordered by a unique key per table and paged via `fetchAll`.
- The file is `tribe-backup-<YYYY-MM-DD>.json`.
- The ledger CSV is oldest first with dollars to the cent.
- The standings CSV is best first with `T2` ties.
- The panel copy says to keep the backup private (it holds balances and injuries) and that sealed bids of an open
  auction are absent.
- The stats CSV stays on the Stats tab.

- [ ] **Step 3: Run the checks**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src && npx tsc && npx eslint . && npm run build`
Expected: backup tests (3) PASS with the rest; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/lib/backup.ts src/app/lib/backup.test.ts src/app/pages/admin/BackupPanel.tsx src/app/pages/admin/AdminPage.tsx
git commit -m "feat(admin): Backup tab — full JSON backup, ledger and standings CSVs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Public rules page (rulebook t01 + FAQ t51)

Model: **sonnet** (UI + copy). Reviewer: sonnet, then `impeccable:impeccable-finish-reviewer` against DESIGN.md.

**Files:**
- Create: `src/app/pages/RulesPage.tsx`, `src/app/pages/RulesPage.test.tsx`
- Modify: `src/core/points.ts` (`stageAllowance`), `src/core/points.test.ts`, `src/app/App.tsx` (route
  `{ path: 'rules', element: <RulesPage /> }`), `src/app/pages/HomePage.tsx` (hero: Sign in + "How it works" in a
  `.row`), `src/app/components/Layout.tsx` (account menu: `Rules` / "How scoring works" after Me),
  `src/app/styles.css` (one line), `DESIGN.md` (one line)

**Interfaces:**
- Produces: `stageAllowance(rank: number, n: number, s: SeasonSettings): number`, which mirrors
  `grant_stage_allowance`: `round(n < 2 ? base : base + gap·(rank−1)/(n−1))`. Used by Tasks 5 and 6.

- [ ] **Step 1: Copy the tests and watch them fail**

```bash
S=$(git stash list | grep m8-verified-draft | cut -d: -f1)
git checkout "$S^3" -- src/app/pages/RulesPage.test.tsx
git checkout "$S" -- src/core/points.test.ts
```

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/app/pages/RulesPage.test.tsx src/core/points.test.ts`
Expected: FAIL — `./RulesPage` not found; `stageAllowance` not exported.

- [ ] **Step 2: Copy the implementation**

```bash
git checkout "$S^3" -- src/app/pages/RulesPage.tsx
git checkout "$S" -- src/core/points.ts src/app/App.tsx src/app/pages/HomePage.tsx src/app/components/Layout.tsx
```

- [ ] **Step 3: Hand-add the one shared CSS line and DESIGN.md line** (Task 4 later copies both whole files)

In `src/app/styles.css`, right after `ul.error { margin: 0; padding-left: 20px; }`:

```css
.card > ul { margin: 0; padding-left: 20px; display: grid; gap: var(--s2); }
```

In `DESIGN.md`, after the `.list` bullet under Components:

```markdown
- **Bullet lists** directly inside a `.card` (the rules page) sit flush with 8px gaps.
```

- [ ] **Step 4: Run the checks**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src && npx tsc && npx eslint . && npm run build`
Expected: all PASS.

Reviewer checks:
- `/rules` renders signed out.
- Every number is computed (`DEFAULT_SETTINGS`, `stageAllowance`, `athleteWeekScore`, `matchupDeltas`,
  `stageMultiplier`, `TIE_EPSILON`).
- It says: DONATION TO THE TEAM FUND, no cash value, not refundable, merch prize, donations off in the beta, no
  trades, and the pick lock day/time in Eastern.
- The copy is plain and short (docs/frontend-principles.md).

- [ ] **Step 5: Commit**

```bash
git add src/core/points.ts src/core/points.test.ts src/app DESIGN.md
git commit -m "feat(ui): public rules page — the rulebook with live numbers and the donation disclosures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Mobile polish and deferred M5/M6 minors

Model: **sonnet** (UI). Reviewer: sonnet. Never touch the tally queue/flush logic beyond the extracted hint.

**Files:**
- Modify:
  - `src/app/pages/AuctionCard.tsx`: loads `min_bid` from the season. A 15 s tick while bidding is open moves
    the countdown and flips the card to "Bids closed" on time. The bid input refuses amounts under `min_bid` or
    decimals with "Bid at least N, in whole credits."
  - `src/app/pages/WeeklyCard.tsx`: "Loading matchups…" while loading. One module-level
    `athleteName(y, id, none)` replaces three local `name` helpers. Used roster rows get `className="used"`.
  - `src/app/pages/admin/StagesPanel.tsx`: "credited 1 team".
  - `src/app/tally/queue.ts`: `subtractHint`.
  - `src/app/tally/queue.test.ts`.
  - `src/app/pages/TallyPage.tsx`: uses `subtractHint`.
  - `src/app/styles.css`: `.bid` wraps right-aligned with its error on its own line; `.list li.used .title` is muted.
  - `DESIGN.md`: `li.used`.

**Interfaces:**
- Produces: `subtractHint(count: number): string`, which returns 'Only your own taps can be removed.' when
  count > 0, else 'Already at 0.'.

- [ ] **Step 1: Copy the test and watch it fail**

```bash
S=$(git stash list | grep m8-verified-draft | cut -d: -f1)
git checkout "$S" -- src/app/tally/queue.test.ts
```

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/app/tally`
Expected: FAIL — `subtractHint` not exported.

- [ ] **Step 2: Copy the implementation**

```bash
git checkout "$S" -- src/app/tally/queue.ts src/app/pages/TallyPage.tsx src/app/pages/AuctionCard.tsx \
  src/app/pages/WeeklyCard.tsx src/app/pages/admin/StagesPanel.tsx src/app/styles.css DESIGN.md
```

Reviewer checks:
- The tick's `useEffect` runs before any early return (hooks order) and clears its interval.
- `auctionPhase`/`timeLeft` get the ticking `now`.
- `.bid small` spans the row.
- The phone `@media` block is still last in styles.css.
- The Task 3 CSS line is still present.

- [ ] **Step 3: Run the checks**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src && npx tsc && npx eslint . && npm run build`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app DESIGN.md
git commit -m "fix(ui): auction countdown ticks, min-bid check, weekly loading/used rows, tally hint test, grammar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Year simulator and tuning sweep (board t64)

Model: **haiku** (copy + run). Reviewer: sonnet.

**Files:**
- Modify: `src/core/simulate.ts` (`simulateYear` replaces `simulateSeason`), `src/core/simulate.test.ts`,
  `package.json` (`"tune": "tsx scripts/tune.ts"` replaces `"sim"`)
- Create: `scripts/tune.ts`
- Delete: `scripts/sim.ts`

**Interfaces:**
- Consumes: `stageAllowance` (Task 3); `scoreYear`, `YearInput` (`src/core/year.ts`); `allocate`, `fillLeftovers`.
- Produces: `simulateYear(cfg: { managers; athletes; stages; weeksPerStage; seed; settings?; tanker? }):
  { settings; managerIds; readNoise; placesByStage; input: YearInput; result: YearResult }`.

- [ ] **Step 1: Copy the test and watch it fail**

```bash
S=$(git stash list | grep m8-verified-draft | cut -d: -f1)
git checkout "$S" -- src/core/simulate.test.ts
```

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/core/simulate.test.ts`
Expected: FAIL — `simulateYear` not exported.

- [ ] **Step 2: Copy the implementation**

```bash
git checkout "$S" -- src/core/simulate.ts package.json
git checkout "$S^3" -- scripts/tune.ts
git rm -q scripts/sim.ts
```

Reviewer checks:
- Each stage grants the allowance from standings 3 days after the stage starts (once the closing tournament has
  locked), runs a sealed auction, picks by each manager's read, and generates stats.
- RNG streams are per purpose, so a tanker changes nothing but their own picks and what follows from them.
- The tanker starts their worst athlete in each stage's last week.

- [ ] **Step 3: Run the checks and the sweep**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src && npx tsc && npx eslint . && npm run tune -- 200`
Expected: tests PASS. The sweep (~80 s) prints 48 rows. With the current defaults, the row for gap 30 / k 2 /
0.9/0.6 reads about "sharp wins 15%, churn 2.26, tank Δ +0.27, tank pays 14.5%" (spec amendments §5 results).

- [ ] **Step 4: Apply the user's tuning decision.** Recommended, pending the user's answer at plan review:
  `upset_k` 2 → 0.5. If the user keeps 2, skip this step.

In `src/core/settings.ts` `DEFAULT_SETTINGS`: `upset_k: 2,` → `upset_k: 0.5,`.
In `src/core/settings.test.ts` (the "has the stage decay and pick lock defaults" test): `upset_k: 2,` → `upset_k: 0.5,`.
In `src/app/pages/RulesPage.test.tsx`:

```ts
    // Last beats 1st with upset_k 0.5: 3 × (1 + 0.5) = +4.5 for the winner, −1 × 1.5 = −1.5 for the loser.
    expect(screen.getByText('Last beats 1st').parentElement?.textContent).toBe('Last beats 1st+4.5-1.5');
```

Run: `npx vitest run src && npx vitest run tests/db` (DB tests alone). Expected: all PASS. The DB suite doesn't
depend on `upset_k`; this was checked while planning.

- [ ] **Step 5: Commit**

```bash
git add -A src/core scripts package.json src/app/pages/RulesPage.test.tsx
git commit -m "feat(core): simulateYear + npm run tune (allowance gap × upset_k × decay, tanking check); upset_k 0.5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Drop "; upset_k 0.5" from the message if Step 4 was skipped.)

---

### Task 6: Full dry run on the real migrations (board t36)

Model: **haiku** (copy + run). Reviewer: sonnet.

**Files:**
- Create: `tests/db/dry-run.test.ts`

**Interfaces:**
- Consumes: `auctionFixture`, `member`, `grant`, `openAuction`, `bid`, `closeBids`, `runAuction`, `injure`
  (`tests/db/auction-fixture.ts`); `makeKeeper`, `tap` (`tests/db/stats-fixture.ts`); `toYearInput`,
  `LeagueRows` (`src/app/lib/weekly.ts`, the app's own mapping); `scoreYear`; `stageAllowance` (Task 3).

- [ ] **Step 1: Copy the test**

```bash
S=$(git stash list | grep m8-verified-draft | cut -d: -f1)
git checkout "$S^3" -- tests/db/dry-run.test.ts
```

- [ ] **Step 2: Run it alone, three times**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; for i in 1 2 3; do npx vitest run tests/db/dry-run.test.ts --reporter=verbose; done`
Expected: 5 tests PASS every run. The standings table prints. Places 1–6 get next allowances 100, 106, 112, 118,
124, 130 (the exact teams depend on `upset_k`).

The flow it drives:
- 6 managers and 25 athletes, one of them injured (24 healthy for 24 slots, so the random fill always deals every
  healthy athlete).
- A tie on A0 goes to the first bid; Ben overspends.
- The auction gives 8 by bid, 16 by fill, 0 empty.
- 4 weeks: a skipped Sunday, then 3 final weeks.
- Ben's week-3 pick is injured before the lock and gets swapped; Cal misses week 4 and gets filled.
- The next stage's allowance from these standings equals `stageAllowance` (the SQL ↔ TS pin).

- [ ] **Step 3: Full DB suite alone**

Run: `npx vitest run tests/db`
Expected: 137 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/db/dry-run.test.ts
git commit -m "test(db): full dry run — six managers, auction, taps, verify, picks, scoring, next allowance

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Go-live (controller + user)

**Files:**
- Modify: `docs/setup-supabase.md` (M8 section)

- [ ] **Step 1: Copy the go-live doc and commit**

```bash
S=$(git stash list | grep m8-verified-draft | cut -d: -f1)
git checkout "$S" -- docs/setup-supabase.md
git add docs/setup-supabase.md
git commit -m "docs: M8 go-live steps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Full verification on the branch**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx tsc && npx eslint . && npx vitest run src && npm run build`,
then `npx vitest run tests/db` alone. Expected: 153 app/core + 137 DB tests PASS.
Confirm `git diff "$S" -- src tests supabase scripts DESIGN.md docs .github package.json` shows only the Task 5
Step 4 tuning edits (if applied) and line endings.

- [ ] **Step 3: Final whole-branch review.** An opus reviewer goes over `main..m8-hardening` against the spec
  (including the amendments); fix findings.

- [ ] **Step 4: User pastes `supabase/migrations/0009_hardening.sql`** into the tribe-dev SQL Editor (the live DB).
  Give the user only that file. It is safe before or after the deploy.

- [ ] **Step 5: Visual check in the preview** (the "tribe-fantasy" launch config; if another chat holds port 5173,
  navigate the pane to its URL instead):
  - Signed out at `http://landing.localhost:5173/Tribe-Fantasy/#/rules` and the landing hero ("How it works").
  - Signed in: Admin → Backup, the account menu's Rules link, and the League tab.
  - Check at 375×812 with no horizontal scroll. If screenshots time out, use `get_page_text` and a
    `scrollWidth` check.

- [ ] **Step 6: With the user's OK**:
  - Merge to `main`, push, and confirm CI + Deploy are green (the deploy's new secret check included) and the
    live bundle has the rules page.
  - Tag `m8` and push the tag.
  - Drop the `m8-verified-draft` stash.
  - Tick board tasks t01 t36 t48 t49 t50 t51 t64, and add a t54 note: "Admin → Backup weekly".
  - Run `graphify update .` and report node/edge counts.
  - Update the Tribe-Fantasy memory.
  - Remind the user to check **Admin → Settings → upset_k** on the live season. If the season stores its own value,
    the new default doesn't apply to it.
