# M8 Hardening — design

Status: approved in chat 2026-09-27. Branch `m8-hardening`. Board: t01, t36, t48, t49, t50, t51, t64.
Goal: the app is safe, backed up and understandable before the fall beta (auction Oct 18, first real tally
Oct 17–18). Trades stay parked (no trade work, no trade rate limits).

Build order: §1 security → §2 backup → §4 rules → §3 polish → §5 tuning → §6 dry run (last: it exercises the rest).

## 1. Security pass (t48)

- **Audit.** An opus reviewer reads migrations 0001–0008, every `public` function, the RLS policies and the client
  (`src/app`), looking for: missing admin/owner/membership checks, rows readable outside the league, sealed data
  leaking (bids before close, other managers' picks before the lock, balances beyond owner + staff), `security
  definer` functions without `set search_path = ''`, grants that bypass the locked default privileges.
  Real findings are fixed in ONE new migration `0009_hardening.sql`, each with a DB test. No finding → no migration.
- **Gate test.** `tests/db/rpc-gate.test.ts` covers every `public` function (38 today), discovered from
  `pg_proc` rather than a hand list, so a new RPC without a gate fails the test: admin RPCs reject a non-admin with
  `FORBIDDEN`; anon can execute nothing.
- **Bundle check.** `deploy.yml` fails after `npm run build` if `dist/` contains `service_role` or `sb_secret_`.
- **Skipped: bid rate limits.** `place_bid` only upserts the caller's own sealed bid; Supabase already rate-limits
  auth. Add one if the audit finds a real abuse path.

## 2. Backup + export (t49)

- New admin tab **Backup** (`src/app/pages/admin/BackupPanel.tsx`), for the selected season:
  - **Download backup**: one JSON file `tribe-backup-<season>-<YYYY-MM-DD>.json` = `{ exportedAt, seasonId,
    tables: { <table>: rows[] } }` of every table the admin can read. Paged reads (1000 rows per request) so large
    tables are complete. Sealed bids of an open auction are not readable by admins (by design) and are absent.
  - **Ledger CSV**, **Standings CSV** (from `scoreYear` per league, same numbers as the League tab), **Stats CSV**
    (reuses the existing stats export). All via the existing `toCsv` / `downloadText` in `src/app/lib/stats.ts`.
- No restore button: restore = user pastes rows back via the SQL editor with help (rare; YAGNI).
- "Download backup" is added to the weekly ops checklist (t54 note).

## 3. Mobile polish + deferred minors (t50)

- 375×812 pass (preview) on League (bid, pick, standings, weeks), Tally, Stats, Admin, Rules.
- Known fixes: dark-mode accent button and error text meet 4.5:1 (tokens.css only); `.linklike` tap target ≥ 44px;
  nav fits at 375px for an admin who is also a keeper.
- M5 minors: live countdown tick on the auction card (1 s interval only while mounted and open); the bid input
  refuses amounts below `min_bid` client-side with a message (0 = delete bid); saved-bid row doesn't wrap on phones.
- M6 minors: WeeklyCard shows "Loading…" instead of nothing; "used" athletes are greyed rows, not just disabled
  buttons; "credited 1 team(s)" grammar; one shared athlete `name()` helper instead of three; injuries query filtered
  to the season's athletes; TallyPage test for the "Only your own taps" / "Already at 0" hints; DB tests for
  `create_stage_weeks` / `set_week_lock` NOT_FOUND + audit detail and a cross-league `set_pick`.
- Skipped (known ceilings): `scoreYear` stays one function; loaders other than stat_lines/picks stay unpaged
  (fine < 1000 rows); `per_point` per-session sums (mode unused); client vs DB clock at the lock (server rejects).
- User-side: one on-phone hold-to-subtract check including a screen reader.

## 4. Rules page (t01 + t51)

- Public route `#/rules` (`src/app/pages/RulesPage.tsx`), readable signed out, linked from the landing page and the
  avatar menu. Follows DESIGN.md + tokens.css.
- Numbers come from the code defaults (`DEFAULT_SETTINGS` in `src/core/settings.ts`), not the live season: signed-out
  visitors can't read season settings, and it keeps the page in sync with the code. A line says the commissioner
  can change settings per season.
- Sections: how a year works (stages ending at tournaments, fresh sealed auction each stage, free allowance, weekly
  pick of a different athlete, no trades); scoring with a worked example computed by `athleteWeekScore` at render
  (so it can't go stale); points and upsets (rank-weighted, `upset_k`); degradation; injuries and missed picks;
  FAQ; disclosures: credits are a DONATION TO THE TEAM FUND, have no cash value, are not refundable; the prize is
  merch; donations are off in the beta.
- Claude drafts the wording; the user reviews it (it doubles as the rulebook for legal and the team meeting).

## 5. Simulator tuning (t64) — approach A

- `simulateYear(cfg)` in `src/core/simulate.ts` builds a fake season as **YearInput rows** (stages, weeks, members,
  roster slots, picks, sessions, stat lines, injuries) and scores it with the real `scoreYear`, stage by stage:
  allowance from the current ranks → sealed auction (`allocate` + `fillLeftovers`) → weekly picks → stats.
  Credits carry over between stages. `simulateYear` replaces the single-stage `simulateSeason` (its test and `npm run sim` move to the year version).
- The allowance formula is mirrored in TS: `allowance(rank, n, s) = round(n < 2 ? base : base + gap·(rank−1)/(n−1))`,
  with a DB test pinning it to `grant_stage_allowance` on a few ranks.
- Fake managers bid on perceived athlete skill (true skill + noise); managers differ in how noisy their read is.
- `npm run tune` sweeps `allowance_gap` × `upset_k` × (`decay_rate`, `decay_floor`) over ~200 seeds (6×4 league,
  3 stages) and prints per combo: (a) % of years the manager with the best skill read finishes 1st; (b) rank churn
  between stages; (c) **tanking**: one manager picks their worst athlete in every stage's last week — mean final
  place tanking vs honest (tanking must never be better on average).
- Output: a table + Claude's recommended defaults. The user decides; changing `DEFAULT_SETTINGS` doesn't affect seasons
  with saved settings (the editor saves every key). Re-run on real stats after Oct 17–18 (outside M8).

## 6. Full dry run (t36)

- `tests/db/dry-run.test.ts` on PGlite with all migrations: 6 fake managers in one league, one stage:
  grant allowance → open auction → sealed bids (incl. ties and an over-budget bid) → run auction + fill →
  create weeks → 3 weeks of taps → verify → lock → picks incl. one injured-at-lock swap and one missed pick →
  load rows → `scoreYear`.
- Asserts invariants: every ledger balance ≥ 0 after bids; rosters full, or short only when supply is short;
  no athlete on two rosters; standings points never NULL; W+L+T per team = weeks played; scores reproduce twice.
- Prints the standings table for the user to check by hand. Stays in CI.

## Testing

Each section ships its own tests (DB tests for SQL, unit tests for core, component tests where a hint/label matters).
All of tsc, lint, build, app/core and DB suites green before merge. Final opus review.

## Go-live

If `0009` exists: user pastes it into tribe-dev BEFORE merging (additive fixes only). Then merge + push with user OK,
CI + Deploy green, live bundle check, tag `m8`, tick board t01 t36 t48 t49 t50 t51 t64, `graphify update .`.

## Amendments from the verified build (2026-09-27)

Found while building the draft; these override the sections above where they differ.

- **§1 audit result** (opus, read-only; no HIGH findings). Fixed in `0009_hardening.sql`:
  1. `set_week_lock` could move a lock that had already passed, which unsealed picks and allowed picking after the
     results → `PICK_LOCKED` once the old lock has passed.
  2. `owns_athlete` looked only at the latest auctioned stage, so a stage's closing tournament (tallied and verified
     after the next auction ran) wasn't owner-gated → it also counts stages that ended in the last 7 days. The tally
     screen's grey-out (`ownershipStages` in `src/app/lib/auction.ts`) mirrors this with an 8-day window, because
     one refused tap drops its whole batch.
  3. A keeper who is the athlete could report and auto-confirm (or confirm) their own injury → blocked.
  - Guards added: `private` has no usage/execute for anon/authenticated; every security definer function pins
    `search_path`. The gate test was already `pg_proc`-driven, and anon execute was already guarded.
  - Skipped (LOW, noted for spring): look-alike display names in the admin pickers; roster data readable across
    leagues (fine with one league); two `run_auction` calls on different stages at once (admin-only); keepers can
    create counted sessions on past dates (legit backfill, audited); admin-chosen 6-character invite codes.
- **§1 bundle check** also catches a legacy `service_role` JWT (its base64 at three alignments).
- **§2**: the backup is the whole database (every table), not one season: a backup should be complete. The file is
  `tribe-backup-<YYYY-MM-DD>.json` = `{ exportedAt, tables }`. The stats CSV stays on the Stats tab (the panel
  points there) instead of being duplicated.
- **§3**: the contrast, `.linklike` and nav-overflow findings were from the old green theme; checked at 375px on
  the current one and they pass, so there are no token changes. A bid below `min_bid` is refused with a message
  (**Remove** deletes a bid; 0 is not a delete). The injuries query is already filtered to the season in
  `toYearInput`, so that item is dropped. The countdown ticks every 15 s (it shows minutes).
- **§5**: `stageAllowance(rank, n, s)` lives in `src/core/points.ts` and the rules page uses it too. The DB pin is in
  the dry run (next stage's allowance from real standings equals `stageAllowance`). `npm run sim` is replaced by
  `npm run tune -- [seeds] [managers] [roster]`.
- **§5 results** (200 seeds, 6×4, 3 stages × 3 weeks; random chance of winning 16.7%):
  - Tanking never pays **on average** in any combo (mean place Δ +0.2 to +0.5), but it helps in 11–19% of single
    years.
  - Decay barely matters: a manager rarely starts the same athlete in 2+ earlier stages.
  - The "sharpest read wins" rate stays near chance (12–22%): stat noise dominates manager skill in a 3-stage
    simulated year.
  - Current defaults (gap 30, `upset_k` 2): tank Δ +0.27, tank pays 14.5%, churn 2.26.
  - With `upset_k` ≥ 1, a favourite beating a team far below it earns **0**: the factor `1 + k·u` clamps at 0 for
    u ≤ −1/k. The rules page shows "1st beats last: 0 / 0".
  - **Recommendation: `upset_k` 0.5**, keep gap 30 and decay. Tank Δ rises to +0.49 (tanking hurts more), tank
    pays drops to 11%, churn falls to 1.7, and every win earns something (1st beats last +1.5). This is a TS-only
    change (scoring runs in the browser); a season whose settings store `upset_k` keeps its own value.
- **§6**: supply is exactly 24 healthy athletes plus 1 injured, so the fill deals every healthy one. With spare
  athletes the fill leaves a random one out, which made an assertion flaky.
