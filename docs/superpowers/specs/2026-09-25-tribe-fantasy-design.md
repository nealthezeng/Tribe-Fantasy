# Tribe Fantasy — Design Spec

Date: 2026-09-25 · Status: approved in conversation, awaiting written-spec review

## 1. Purpose

A fantasy league for our college ultimate team where **all money raised goes to the team's
donation fund**. Supporters donate for credits, bid on real teammates ("athletes") in a sealed
auction, then play weekly head-to-head matchups decided by stats recorded at practices and
tournaments. A prize goes to the league winner at season's end.

Success looks like: a full spring season runs on the app with no disputes that the audit trail
can't settle, credits that always reconcile to confirmed donations, and a published fundraising
total at the end.

**Non-goals for v1:** the app never holds or moves money (no payment processing — donations go
through an official channel and are recorded here as receipts); no native mobile app; no live
in-app chat.

**Blocking outside the code (P0):** written sign-off from the club sports office / student legal
services before any real money, a named treasurer, and the official money destination. The
`free_entry` setting (§4) exists so a "no donation necessary" path can be switched on if legal
requires it.

## 2. Architecture

```
Browser (phone/laptop)                      Supabase (free tier)
┌──────────────────────────────┐            ┌──────────────────────────────────┐
│ React + TS SPA (Vite)        │  supabase  │ Auth: email magic link + invite  │
│ hosted on GitHub Pages       │  -js       │ Postgres: all state              │
│ src/core: pure game logic    │ ─────────▶ │ RLS on every table               │
│ (scoring, allocation, …)     │            │ RPC functions = the only writes  │
└──────────────────────────────┘            └──────────────────────────────────┘
```

- **Hosting:** GitHub Pages, public repo, deployed by GitHub Actions on push to `main`.
  Hash routing (`/#/draft`) because Pages has no SPA fallback.
- **Backend:** Supabase. No custom server, no edge functions, no cron.
- **Write path:** clients have `select` only (as RLS allows). Every state change is a
  `security definer` Postgres function (RPC) that validates rules in one transaction and writes
  an `audit_log` row. Time checks use the database clock (`now()`), never the client's.
- **Heavy one-shot jobs** (draft allocation, weekly scoring, rescoring) run in the **admin's
  browser** using `src/core`, then are submitted through a single admin-only RPC that writes
  all results in one transaction. Inputs are public once the phase closes, so any manager can
  press **Verify** to recompute with the same code and compare.
- **Environments:** two Supabase projects — `tribe-dev` (beta, mock season) and `tribe-prod`.
  The Supabase URL and anon key are public build-time config (GitHub repo variables). The
  service-role key and DB password never enter the repo, CI logs, or the client.
- **Known limitation:** free Supabase projects pause after 7 days of inactivity; restore is one
  click. In-season weekly traffic keeps it awake.

### Repo layout

```
src/core/        pure TS, zero dependencies, 100% unit-tested (the game rules)
src/app/         React UI (routes, components, supabase client, hooks)
supabase/migrations/  numbered SQL: schema, RLS policies, RPC functions
tests/db/        PGlite tests of migrations, RLS and RPCs
tests/sim/       season simulator (also a settings-tuning tool)
.github/workflows/  ci.yml (lint, typecheck, test), deploy.yml (Pages)
```

## 3. Roles

| Role | Can |
|---|---|
| member | join a league with an invite code, manage one team per league, bid, pick, trade, record donation intents |
| stat_keeper | enter and verify stat lines — never for an athlete they own, and never verify their own entry |
| treasurer | confirm donations (which grants credits) |
| admin (commissioner) | everything: seasons, leagues, athletes, weeks, settings, run allocation/scoring, veto trades, corrections |

Roles are rows in `user_roles`, checked by RPCs and RLS helper functions.

## 4. Season settings (the open rules live here, not in code)

Stored as validated JSON on `seasons.settings`; editable by admin until the season goes live,
after which changes are logged in `audit_log`. Defaults below are placeholders we'll tune.

| Key | Default | Meaning |
|---|---|---|
| `credits_per_dollar` | 20 | $1 donated = 20 credits |
| `min_credits_to_play` | 100 | a membership is **active** once its lifetime credited total ≥ this |
| `extra_credit_cap` | null | null = unlimited credits per season |
| `free_entry` | false | if true, admin may grant `min_credits_to_play` free on request |
| `roster_size` | 5 | athletes per team |
| `min_bid` | 1 | credits |
| `exclusive_ownership` | true | one owner per athlete per league |
| `allow_self_ownership` | false | an athlete linked to a user can't be owned by that user |
| `stat_weights` | goal 3, assist 3, block 3, callahan 8, completion 0.2, throwaway −2, drop −2, stall −2 | points per stat |
| `normalize_mode` | `per_point` | `per_point` divides by points played; `none` uses raw totals |
| `normalize_per_points` | 1 | scale: score is expressed per this many points played (1 = per point) |
| `min_points_denominator` | 5 | floor on points played in the denominator (stops 1-point flukes) |
| `session_multipliers` | practice 1, tournament 2 | |
| `absent_score` | 0 | week score when a picked athlete played no counted session |
| `points_mode` | `rank_weighted` | or `fixed` |
| `win_points` / `loss_points` / `tie_points` | 3 / 1 / 1 | base magnitudes (loss is subtracted) |
| `upset_k` | 1.0 | strength of the rank weighting (0 = fixed) |
| `standings_floor` | null | null = standings points may go negative |
| `decay_mode` | `exponential` | `exponential`, `linear` or `none` |
| `decay_grace_weeks` | 2 | |
| `decay_rate` | 0.95 | per-week factor (exponential) or per-week step 0.05 (linear) |
| `decay_floor` | 0.5 | |
| `decay_return_window` | 4 | weeks; see anti-collusion in §5.4 |
| `usage_reset` | `cycle` | no-repeat resets once every rostered athlete has been used |
| `default_pick` | `best_unused` | or `forfeit` |
| `trade_review_hours` | 24 | |
| `trade_keeps_usage` | true | a traded athlete used this cycle stays used for the new owner |
| `stat_lock_hours` | 48 | after verification |

Key dates are columns on `seasons`: `donations_open_at`, `bid_close_at`, `leftover_bid_close_at`,
`trade_deadline`, `season_end_at`.

## 5. Game rules (implemented in `src/core`)

### 5.1 Athlete week score

For athlete *a* in week *w*, over the counted sessions *s* in that week:

```
raw(s)   = Σ_stat weight[stat] × count[stat]
num      = Σ_s mult(s) × raw(s)
den      = max( Σ_s points_played(s), min_points_denominator )   (unweighted, so multipliers really multiply)
score    = num / den × normalize_per_points        (normalize_mode = per_point, default)
score    = num                                     (normalize_mode = none)
score    = absent_score                            (no counted sessions)
```

Default is score **per point played**. Mode and scale are settings, so switching to "per 10
points" or raw totals later is a config change, not a code change.

Only **locked** stat lines count.

### 5.2 Degradation (tenure multiplier)

Each roster slot has `acquired_week` (draft = week 0). When a manager starts an athlete in
week *w*:

```
held = w − acquired_week
d    = max(0, held − decay_grace_weeks)
exponential: m = max(decay_floor, decay_rate^d)
linear:      m = max(decay_floor, 1 − 0.05·d)      (step = 1 − decay_rate)
none:        m = 1
matchup score = athlete week score × m
```

A new owner gets a fresh `acquired_week`, which is the incentive to trade.

### 5.3 Matchup result and rank-weighted points

The higher matchup score wins; a difference under 0.01 is a tie. Ranks are a **snapshot at the
start of the week** (1 = best; tied managers share their average rank; week 1 everyone ties).

```
u = (winner_rank − loser_rank) / (n − 1)     ∈ [−1, 1], > 0 when the underdog wins (u = 0 if n < 2)
fixed:          winner += win_points,             loser −= loss_points
rank_weighted:  winner += win_points·(1 + k·u),   loser −= loss_points·(1 + k·u)
                (each magnitude clamped at ≥ 0; k = upset_k)
tie:            both += tie_points
bye:            no change
```

The exact curve will be tuned later with the simulator; only `upset_k` and the base values
should need to change. Standings points then apply `standings_floor` if set.

### 5.4 Anti-collusion for degradation

If an athlete is acquired by a manager who previously held them and released them within the
last `decay_return_window` weeks, the slot restores the **old** `acquired_week` instead of
starting fresh. Trades also pass through the review window and commissioner veto (§5.8).

### 5.5 Auction allocation

- Bids are sealed: `(league, manager, athlete, amount, placed_at)`, one per manager per athlete,
  editable until `bid_close_at` (an edit resets `placed_at`). Each bid ≥ `min_bid` and ≤ the
  manager's current balance; the total across bids is **not** capped (you may bid on more
  athletes than you can win).
- Only active memberships may bid.
- Allocation (deterministic):
  1. Sort bids by `amount` desc, then `placed_at` asc, then bid id asc.
  2. For each bid: skip if the athlete is taken, the manager's roster is full, or the manager's
     remaining budget < amount. Otherwise assign and deduct.
- **Leftovers:** a second sealed round (`leftover_bid_close_at`, bids ≥ 0) runs the same
  algorithm on unclaimed athletes and open slots. Anything still open is filled by a seeded
  shuffle, where the seed is published before the round.
- Capacity rule: with exclusive ownership, `managers × roster_size ≤ opted-in athletes`, or the
  admin splits signups into multiple leagues.

### 5.6 Schedule

Round robin (circle method) repeated to cover the season's weeks; odd counts get a bye.

### 5.7 Weekly picks

- One pick per manager per week, editable until `weeks.pick_lock_at` (database clock).
- No-repeat: an athlete used in the manager's current cycle can't be picked. A cycle ends once
  every athlete currently on the roster has been used. With `trade_keeps_usage`, an athlete
  used this cycle by any owner counts as used.
- Missed pick: `best_unused` picks the unused athlete with the best average score over the last
  3 weeks (ties → lowest athlete id); `forfeit` scores 0.

### 5.8 Trades

- An offer lists items on each side: athletes and/or credits.
- On accept, the database checks both rosters stay within `roster_size`, both balances cover the
  credits, the deadline hasn't passed, and every athlete is still owned by the side offering them.
- An accepted trade is **pending** for `trade_review_hours`: visible to the league, vetoable by
  the commissioner, then executed atomically (roster slots, ledger entries, audit log).
- Degradation rules apply to the new slots (§5.2, §5.4).

### 5.9 Credits and donations

- `credit_ledger` is append-only. Balance = sum of entries. Entry kinds: `donation`,
  `free_entry`, `draft_win` (negative), `trade_in`, `trade_out`, `adjustment`.
- Donation flow: a member records a donation intent (amount, channel, memo) and pays through
  the official channel. The treasurer confirms it, which inserts one `donation` ledger entry of
  `amount × credits_per_dollar` credits. The donation id is unique on the ledger, so a
  double-confirm can't double-grant.
- Credits have no cash value and are not refundable.
- Donor leaderboard is separate from fantasy standings.

### 5.10 Stats

> Superseded by `2026-09-25-m3-stats-design.md` (tally screen, tap log, attendance, injuries).

- A `session` is a practice or tournament game with a date, type and `counts` flag.
- `stat_lines`: one per athlete per session, with stat counts and `points_played`, entered via a
  phone form or CSV import (column mapping to be set after evaluating the team's stat app).
- Attendance is implied by the presence of a stat line.
- Lifecycle: `entered` → `verified` (by a different keeper or captain) → **locked**
  `stat_lock_hours` after verification. Locked lines are immutable except through an admin
  correction, which triggers the rescore flow and is logged.

## 6. Data model (Postgres)

`profiles`, `user_roles`, `seasons`, `leagues`, `invites`, `memberships`, `athletes`
(`opted_in`, optional `user_id`), `donations`, `credit_ledger`, `bids`, `roster_slots`
(`acquired_week`, `released_week`, `acquired_via`), `weeks`, `matchups`, `picks`, `sessions`,
`stat_lines`, `week_results` (per-athlete score, multiplier, per-matchup deltas — written by the
scoring RPC), `standings_snapshots`, `trades`, `trade_items`, `audit_log`.

RLS summary:

- Everyone signed in can read league-public data: rosters, schedule, locked stats, results,
  standings, trades, and donor totals.
- Bids are readable only by their owner until `bid_close_at`, then by the league.
- Picks are readable only by their owner until `pick_lock_at`.
- Ledger entries are readable by their owner, the treasurer and the admin.

## 7. Errors, disputes, testing

- **Errors:** RPCs raise stable codes (`BID_CLOSED`, `INSUFFICIENT_CREDITS`, `ROSTER_FULL`,
  `ATHLETE_ALREADY_USED`, `NOT_ACTIVE`, `PICK_LOCKED`, `TRADE_DEADLINE_PASSED`, `FORBIDDEN`, …)
  that the UI maps to plain messages.
- **Idempotency:** bid upserts are keyed by (manager, athlete); credit grants carry a unique
  source reference.
- **Disputes:** the audit log, the ledger history, and the rescore tool's before/after record.
- **Tests:**
  - `src/core`: TDD with Vitest, plus property tests for allocation across random drafts. The
    invariants: never over budget, never over roster, deterministic output.
  - `tests/db`: run migrations on PGlite with an `auth.uid()` shim, then assert RLS and RPC
    behaviour.
  - `tests/sim`: an end-to-end fake season.
  - CI runs all of it on every PR.

## 8. Build order

| Milestone | Scope | Taskboard |
|---|---|---|
| M1 Foundation | scaffold, CI, Pages deploy, schema v1, auth + invites, RLS, admin shell, audit log | t14–t19 |
| M2 Core logic | scoring, degradation, rank points, allocation, schedule, picks, simulator | t08, t12, t33 (logic), t37, t39 (logic) |
| M3 Stats | sessions, tally screen, tap merge, attendance + injuries, verify + lock (see M3 addendum) | t21–t23 |
| M4 Credits | ledger UI, donation confirm, activation, donor board | t25, t26, t28, t30 |
| M5 Draft | bid UI, close, allocation run + verify, leftovers, results | t31–t36 |
| M6 Weekly play | picks, lock, scoring run, standings, default pick, rescore | t38–t42 |
| M7 Trades | offers, review/veto, deadline, usage | t43–t46 |
| M8 Hardening | security pass, backups/CSV export, mobile polish, FAQ | t48–t51 |

The first implementation plan covers M1 + M2.
