# Admin Force-Delete (t81) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin delete any athlete or any session no matter what (tallied, verified, locked, bid on,
rostered, picked), refunding auction credits for a deleted athlete; keepers keep the M8.5 limits.

**Architecture:** One migration `0011_force_delete.sql` drops and recreates `delete_athlete` and `delete_session`
with a trailing `p_force boolean default false`. Unforced calls behave exactly as 0010; forced calls are admin-only,
skip every guard, refund priced roster slots via an `adjustment` ledger row, and audit counts of what went. UI: a
second confirm in `AthletesPanel` after `ATHLETE_IN_USE`, and an admin-only "Delete session" button on
`SessionPage`. No new routes, tables, error codes or dependencies.

**Tech Stack:** TypeScript, React 19, Vite, Supabase (Postgres RLS + security-definer RPCs), Vitest, PGlite for DB tests.

**Spec:** `docs/superpowers/specs/2026-10-01-force-delete-design.md` (commit 80524c7). Read it first.

## Global Constraints

- Every executor invokes `ponytail:ponytail` first (the user's standing rule): shortest correct diff, no new deps.
- node/npm are not on the Bash PATH: prefix commands with `export PATH="/c/Program Files/nodejs:$PATH";`.
- UI follows `DESIGN.md`; no new colours or CSS (the existing `secondary` button class is used for Delete, like
  every other Delete/Remove button in the app).
- All writes go through security-definer RPCs with `set search_path = ''`. Never edit an applied migration (0001–0010).
- `p_force` is read through `coalesce(p_force, false)` everywhere (the RPC gate test calls every function with nulls).
- Forced = admin only (`private.require_admin()` → `FORBIDDEN`). Unforced = exactly 0010's behaviour and codes.
- Refund: one `credit_ledger` row per roster slot with `price > 0`: `kind 'adjustment'`, `amount +price`,
  `stage_id` of the slot, `note 'Refund: <athlete name> removed'`, `created_by` the admin.
- DB tests time out when run alongside the dev server or other agents: run `npx vitest run tests/db` on its own.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  (or the executor's own model name).
- The live DB (tribe-dev) holds the real season: never put test data in it — use a throwaway season for any check.

## The verified draft

The full implementation was built and verified while planning: `tsc -b`, `eslint .`, `npm run build`, **171
app/core tests + 153 DB tests** green. It lives in `git stash` **"force-delete-verified-draft"** on branch
`force-delete` (base 80524c7). Executors copy their task's files from it instead of retyping, then run the checks:

```bash
S=$(git stash list | grep force-delete-verified-draft | cut -d: -f1)   # e.g. stash@{0}
git checkout "$S" -- <modified tracked file>                           # files that already exist on the branch
git checkout "$S^3" -- <new file>                                      # files the draft creates (untracked in the stash)
```

Never `git stash pop`/`apply` the whole stash, and never copy `.impeccable/` or `tsconfig.tsbuildinfo`. No file is
shared between tasks, so every copy is whole-file. Reviewers compare each task's diff against the spec, not the stash.

## Review Focus

Inputs the spec implies that are most likely to bite real users. Each has a test in the owning task:

1. **The live (old) build after 0011 is pasted** still calls `delete_athlete({p_athlete})` / `delete_session({p_session})`
   with no `p_force`; the default must make those resolve and behave as 0010 → every pre-existing `delete_athlete`
   / `delete_session` test in `rpc-qol.test.ts` calls without `p_force` and must still pass unchanged (Task 1).
2. **A null `p_force`** (the RPC gate calls every function with all-null args) must take the unforced path, so a
   keeper/player still gets `FORBIDDEN` and never a forced delete → `rpc-gate.test.ts` unchanged and green (Task 1).
3. **Refunds go only to priced slots, to the right manager, in the right stage**: a manager who got the athlete
   free from the fill gets nothing; the bidder's balance rises by exactly the price → "wipes all history, refunds
   only priced roster slots" (Task 1).
4. **A keeper forcing — even on a session they created** — is refused and nothing is deleted → "refuses a keeper
   forcing, even the creator" + "refuses a keeper even when forced" (Task 1).
5. **The admin says no to the second warning**: nothing is deleted and no error appears; any error other than
   `ATHLETE_IN_USE` shows as today without a second prompt → `AthletesPanel.test.tsx` (Task 2).

---

### Task 1: Migration 0011 + client wrappers (DB)

Model: sonnet implements; **opus reviews** (security-definer SQL, cascades, money).

**Files:**
- Create: `supabase/migrations/0011_force_delete.sql`
- Modify: `tests/db/rpc-qol.test.ts`, `src/app/lib/rpc.ts`

**Interfaces:**
- Produces (SQL): `public.delete_athlete(p_athlete uuid, p_force boolean default false) returns void` (admin);
  `public.delete_session(p_session uuid, p_force boolean default false) returns void` (unforced: keeper-creator
  or admin; forced: admin). The one-argument signatures no longer exist.
- Produces (TS, `api` in `src/app/lib/rpc.ts`): `deleteAthlete(athleteId: string, force = false): Promise<void>`,
  `deleteSession(sessionId: string, force = false): Promise<void>` — both always send `p_force`.
- Audit details: `delete_athlete` → `{season_id, name, user_id, force}` + when forced
  `{taps, lines, attendance, injuries, bids, slots, picks, refunded}`; `delete_session` →
  `{season_id, kind, held_on, force}` + when forced `{verified, taps, lines}`.

- [ ] **Step 1: Copy the tests first**

```bash
S=$(git stash list | grep force-delete-verified-draft | cut -d: -f1)
git checkout "$S" -- tests/db/rpc-qol.test.ts
```

What the change is: imports `backdateVerify`; adds `describe('delete_athlete forced (t81)')` with 3 tests and
`describe('delete_session forced (t81)')` with 2 tests:
- forced athlete: alice holds the athlete at price 30 (superuser `roster_slots` insert), bob — moved to a second
  league "B" so the `(stage, league, athlete)` unique key allows it — holds it at 0 via `fill`, plus one bid and one
  pick. After `delete_athlete(p_force: true)`: athlete, bids, slots, picks gone; alice's ledger sum +30, bob's
  unchanged; exactly one refund row `{kind 'adjustment', note 'Refund: A0 removed', stage_id}`; audit
  `{force: true, bids: 1, slots: 2, picks: 1, refunded: 30}`.
- forced athlete with a tap and a stat line → both gone; audit `{taps: 1, lines: 1, refunded: 0}`.
- keeper k1 forcing an athlete delete → `FORBIDDEN`.
- forced session: two taps, one stat line, verified 49 h ago (past the 48 h lock) → session and taps gone; audit
  `{force: true, verified: true, taps: 2, lines: 1}`.
- keeper k1 (the session's creator) forcing → `FORBIDDEN`, session still there.

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run tests/db/rpc-qol.test.ts`
Expected: the 5 new tests FAIL (no function matches the `p_force` argument); the 9 existing tests pass.

- [ ] **Step 3: Copy the migration and the wrappers**

```bash
git checkout "$S^3" -- supabase/migrations/0011_force_delete.sql
git checkout "$S" -- src/app/lib/rpc.ts
```

The migration, in order: `drop function public.delete_athlete(uuid); drop function public.delete_session(uuid);`
then recreates both with `p_force boolean default false`.
- `delete_athlete`: `uid := private.require_admin()`, lock the row, `NOT_FOUND`. Unforced → 0010's seven
  `exists` checks → `ATHLETE_IN_USE`. Forced → sum priced slots into `refunded`; `insert into credit_ledger
  (membership_id, stage_id, kind, amount, note, created_by) select membership_id, stage_id, 'adjustment', price,
  'Refund: ' || a.name || ' removed', uid from roster_slots where athlete_id = p_athlete and price > 0`; build the
  counts jsonb. Then delete; audit `jsonb_build_object(...) || removed`.
- `delete_session`: `if f then uid := private.require_admin(); else uid := private.require_keeper(); end if;` lock,
  `NOT_FOUND`; unforced → 0010's creator/`SESSION_VERIFIED`/`SESSION_NOT_EMPTY` checks; forced → counts. Delete;
  audit.
- Ends with the same revoke-from-`public, anon` / grant-to-`authenticated` loop as 0010, for both names.

`rpc.ts`: `deleteAthlete: (athleteId: string, force = false) => call<void>('delete_athlete', { p_athlete:
athleteId, p_force: force })`, and the same shape for `deleteSession` with `p_session`.

- [ ] **Step 4: Run the DB tests (alone)**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run tests/db`
Expected: 15 files, 153 tests PASS (incl. `rpc-gate.test.ts` unchanged: it discovers the new 2-arg signatures
from pg_proc and calls them with nulls).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc -b && npx eslint .` — Expected: no output.

```bash
git add supabase/migrations/0011_force_delete.sql tests/db/rpc-qol.test.ts src/app/lib/rpc.ts
git commit -m "feat(db): admins can force-delete athletes (with refunds) and sessions (t81)"
```

---

### Task 2: Admin UI — second confirm on Remove, Delete on the session page

Model: sonnet implements; sonnet reviews.

**Files:**
- Modify: `src/app/pages/admin/AthletesPanel.tsx`, `src/app/pages/SessionPage.tsx`
- Create: `src/app/pages/admin/AthletesPanel.test.tsx`, `src/app/pages/SessionPage.test.tsx`

**Interfaces:**
- Consumes: `api.deleteAthlete(athleteId, force = false)`, `api.deleteSession(sessionId, force = false)` (Task 1).
- Produces: nothing other tasks use.

- [ ] **Step 1: Copy the tests first**

```bash
S=$(git stash list | grep force-delete-verified-draft | cut -d: -f1)
git checkout "$S^3" -- src/app/pages/admin/AthletesPanel.test.tsx src/app/pages/SessionPage.test.tsx
```

- `AthletesPanel.test.tsx` (4 tests; mocks `supabase` with one athlete "Sam", mocks `api.deleteAthlete`, stubs
  `window.confirm`): unused athlete → one confirm, `deleteAthlete('a1')`; `ATHLETE_IN_USE` then yes → second
  confirm mentioning "change past results and standings", `deleteAthlete('a1', true)`, no alert; second confirm
  declined → only one call, no alert; `FORBIDDEN` → alert "You don't have permission…", one confirm.
- `SessionPage.test.tsx` (3 tests; mocks `useAuth`, `supabase` with a session verified 2026-01-01 so it is locked,
  `api.deleteSession`; routes `/stats/:id` and `/stats`): admin + yes → `deleteSession('s1', true)`, confirm text
  contains "Past results and standings can change", lands on `/stats`; declined → no call; non-admin keeper → no
  "Delete session" button.

- [ ] **Step 2: Run them to see them fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/app/pages/admin/AthletesPanel.test.tsx src/app/pages/SessionPage.test.tsx`
Expected: FAIL — the second-confirm tests (no second call) and all SessionPage tests that look for "Delete session".
The "unused athlete" and "FORBIDDEN" tests may already pass.

- [ ] **Step 3: Copy the components**

```bash
git checkout "$S" -- src/app/pages/admin/AthletesPanel.tsx src/app/pages/SessionPage.tsx
```

- `AthletesPanel.remove`: after the existing confirm, `run(async () => { try { await api.deleteAthlete(a.id) }
  catch (err) { if (err?.message !== 'ATHLETE_IN_USE') throw err; if (!window.confirm(`${a.name} has stats, bids,
  roster spots or picks. Deleting removes all of it, refunds auction credits, and can change past results and
  standings. Delete anyway?`)) return; await api.deleteAthlete(a.id, true) } })`.
- `SessionPage`: `useNavigate`; `remove()` confirms "Delete the <title> session and all its stats? Past results
  and standings can change. This can't be undone.", sets busy, calls `api.deleteSession(id, true)`, then
  `navigate('/stats')`; on error shows it in the page's existing error line and clears busy. Rendered last in the
  section: `{isAdmin && <p><button className="secondary" disabled={busy} onClick={() => void remove()}>Delete
  session</button></p>}` — shown in every state (open, verified, locked).

- [ ] **Step 4: Run all app tests + build**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run --exclude 'tests/db/**' && npx tsc -b && npx eslint . && npm run build`
Expected: 29 files, 171 tests PASS; tsc/eslint silent; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/admin/AthletesPanel.tsx src/app/pages/admin/AthletesPanel.test.tsx src/app/pages/SessionPage.tsx src/app/pages/SessionPage.test.tsx
git commit -m "feat(ui): admins can delete used athletes and any session after a strong confirm (t81)"
```

---

### Task 3: Go-live (controller, with the user)

Not a subagent task.

- [ ] Final opus review of the whole branch (`git diff main...force-delete`).
- [ ] User pastes `supabase/migrations/0011_force_delete.sql` into the tribe-dev SQL Editor (safe before the
  deploy: the live build's one-argument calls still resolve through the default).
- [ ] Verify via anon probe that `delete_athlete` / `delete_session` answer 42501 for anon (as after 0010).
- [ ] Optional visual check in the preview on a throwaway season (Stats → a session → Delete session; Admin →
  Athletes → Remove a used athlete → second confirm).
- [ ] With the user's OK: merge to main, push, watch CI + Deploy, tag `m8.6`, tick board t81, drop the stash,
  `graphify update .`.
