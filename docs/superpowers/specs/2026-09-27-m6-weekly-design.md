# M6: weekly play

Agreed with the user on 2026-09-27. Builds on `2026-09-25-year-stages-revision.md` (§1, §4, §5) and the M6 gates in
`docs/superpowers/plans/2026-09-25-m1-m2-foundation-and-core.md`. Board: t38 t39 t40 t41 t42 t62 t63 t75.

## 1. Decisions

- **Scoring runs in every browser** from `src/core` (approach A). All inputs are league-readable once a week locks
  (picks, locked stat lines, rosters, confirmed injuries), so nothing is stored: no results table, no rescore job.
  A correction, reopen or `stat_lock_hours` change shows up on the next load. Anyone can check the numbers.
- **Pick lock** = a weekday + time (ET) from season settings, copied onto each week when its weeks are created; the
  admin can override one week. Fall: Monday 21:00 (first practice is Monday 21:30). Spring will change it.
- **Injured pick at the lock** is auto-swapped to the best unused healthy athlete, and the manager is told in the app
  (before the lock as a warning, after it as a notice). No email.
- Allowances already granted at a checkpoint never change when a later correction shifts old standings.

## 2. Rules as code runs them

**Weeks.** `create_stage_weeks` splits the stage's `starts_on..ends_on` into 7-day chunks from `starts_on` (the last
may be shorter). `pick_lock_at` = the first day in the chunk whose ISO weekday is `pick_lock_day`, at `pick_lock_time`
in `America/New_York`; if no day matches, the chunk's first day at 00:00 ET. The **year week index** is the order of
all the season's weeks by `starts_on`.

**Schedule.** Per league, `roundRobin(ids, k + 1)[k]` for year week index `k`, where `ids` are the league's
memberships with `created_at ≤ pick_lock_at`. Odd counts get a bye. Late joiners never reshuffle past weeks; they
start at 0 points.

**Counted sessions of a week**: the season's sessions with `counts = true` and `held_on` in the week. A session is
**locked** when `verified_at + stat_lock_hours ≤ now`.

**Week status.**
- `final`: now ≥ the day after `ends_on` at 00:00 ET, the week has ≥ 1 counted session, and all of them are locked.
- `skipped`: the week has ended with no counted session. No matchups, no usage, no degradation.
- `pending`: anything else. The first pending week holds back every later week (status `pending` too), so rank
  snapshots always build in order.

**Effective pick** (per manager, decided as of the lock):
1. The manager's pick stands if it is on their stage roster, unused this cycle, and not injured at the lock.
2. Otherwise `defaultPick` over the unused athletes that are healthy at the lock (if none are healthy, over all
   unused ones), with a notice: `missed` (no pick), `injured`, or `used` (already used, or not on the roster — only
   possible by calling the API directly). `default_pick = forfeit` or no candidate → forfeit (score 0).
- History for `defaultPick`: the athlete's week score in each earlier final week of the year, `absent_score` when
  they have no counted stat line that week (gate).
- **Injured at the lock**: a confirmed injury with `confirmed_at ≤ pick_lock_at` and (`cleared_at` null or
  `> pick_lock_at`).

**Usage** (per stage, `usage_reset` cycle): athletes the manager started in earlier final weeks of the same stage;
the cycle resets once every roster athlete is used. A start does **not** use the athlete when they were injured at
any time during the week (confirmed interval overlaps the week's days) and have no stat line in a counted session.

**Degradation** (revision §4): `s` = number of earlier **stages** in which this manager started this athlete (a start
that used them, in a final week). `m = max(decay_floor, decay_rate ^ max(0, s − decay_grace_stages))` for
`exponential`; `linear` = `max(decay_floor, 1 − (1 − decay_rate)·d)`; `none` = 1. A missing count throws (gate).

**Scoring a final week**: `scoreWeek` on the locked counted stat lines, ranks from the standings after the previous
final week (week 1: all tied), `upset_k` default 2. Standings rows carry points, W-L-T and total score.

**Settings** (`src/core/settings.ts` + migration rewrite of `seasons.settings`):
- rename `decay_grace_weeks` → `decay_grace_stages` (default 1); `decay_rate` 0.9; `decay_floor` 0.6; `upset_k` 2;
- remove `decay_return_window`, `trade_review_hours`, `trade_keeps_usage` (and `resolveAcquiredWeek`);
- add `pick_lock_day` (`mon`…`sun`, default `mon`) and `pick_lock_time` (`HH:MM`, default `21:00`).
- The migration renames the stored key and drops the removed ones. Stored values for `decay_rate`/`decay_floor`/
  `upset_k` are kept (the admin set them deliberately; the new defaults only apply where unset).

## 3. Data (migration `0008_weekly.sql`, additive)

```
weeks  id, stage_id → stages (cascade), starts_on, ends_on, pick_lock_at, unique (stage_id, starts_on)
picks  week_id → weeks (cascade), membership_id → memberships (cascade), league_id, athlete_id → athletes,
       updated_at; primary key (week_id, membership_id)
```

RLS (+ explicit `grant select … to authenticated`, function grant loop):
- `weeks`: every signed-in user.
- `picks`: own rows; after the week's `pick_lock_at`, also league members and staff (`league_id` copied so RLS
  needn't join, like `bids`).
- `injuries`: widen the league clause to confirmed injuries **including cleared ones** (past weeks replay them).

RPCs:

| RPC | Who | Behaviour |
|---|---|---|
| `create_stage_weeks(stage)` | admin | (re)builds the stage's weeks; `WEEKS_HAVE_PICKS` if any existing week has picks; audited |
| `set_week_lock(week, at)` | admin | overrides one week's lock; audited |
| `set_pick(membership, week, athlete \| null)` | the membership's user | `FORBIDDEN` not yours; `NOT_FOUND`; `PICK_LOCKED` once `now() ≥ pick_lock_at`; `NOT_ON_ROSTER` unless the athlete has a `roster_slots` row for (week's stage, membership); null deletes. Audit row names only the membership (picks stay sealed). No-repeat and injury are **not** checked in SQL — the scorer replaces an invalid pick (§2). |
| `grant_stage_allowance(stage, ranks jsonb)` | admin | `{membership_id: rank}` computed by the admin's browser with `rankSnapshot`. `STANDINGS_MISSING` unless every membership of the season has a finite rank in `[1, n]` (n = its league size) — the never-NULL gate. Amount = `round(base + gap·(r − 1)/(n − 1))` (n < 2 → base). Ranks copied into the audit row. Drops `private.standings_points`. |

Go-live: paste 0008 **before** deploying (the old build rejects the new setting keys); hard-reload open admin tabs.

## 4. Core (`src/core`)

- `decay.ts`: `stageMultiplier(stagesStarted, s)` replaces `tenureMultiplier`/`resolveAcquiredWeek`.
- `picks.ts`: `usedThisCycle` loses trade carry-over.
- `week.ts`: `scoreWeek` takes precomputed `multipliers` (keyed `manager:athlete`) instead of `acquiredWeek`; a
  missing key for a started athlete throws.
- `year.ts` (new): `scoreYear(input) → { weeks: WeekOutcome[], standings }` per league. Input: settings, `now`,
  stages, weeks, memberships (id, league, created_at), roster slots, picks, sessions, stat lines, injuries. Each
  `WeekOutcome` has status, matchups (per side: pick as made, effective pick, notice, athlete score, multiplier,
  score, delta) and the standings after it. Pure and deterministic.
- `simulate.ts` moves to stage decay (fake stages of 3 weeks).

## 5. UI (DESIGN.md + tokens.css only)

- `src/app/lib/weekly.ts`: loads the season's rows for a league and calls `scoreYear`.
- **League tab**, per membership, below the auction card:
  1. **This week** — opponent, "Picks lock Mon 9:00 PM", roster buttons (used greyed "used", injury badge), tap to
     pick. Injured pick → "Jordan is injured. At the lock we'll swap in Sam unless you change your pick." After the
     lock: both picks, "Scores once this week's stats lock".
  2. **Standings** — rank (ties "T2"), team, points, W-L-T; own team highlighted.
  3. **Weeks** — final / pending / skipped rows; a final matchup opens its detail: each side's athlete, stat by stat
     per session (×2 on tournaments), week score × multiplier = matchup score, points change, and any notice.
- **Admin → Stages**: Create / Regenerate weeks; weeks list with an editable lock; **Grant allowance** computes ranks
  first and asks to confirm if any week of an earlier stage is still pending.
- **Tally (t75)**: remove Undo. Holding a stat button ~500 ms = −1: an undo tap of this keeper's latest live tap of
  that athlete + stat (existing `undoes`, no DB change). Vibrate/flash; the hold never also adds +1; nothing of
  yours to undo → "Only your own taps can be removed". Each button's menu has −1 for keyboard / screen readers.

## 6. Tests

- Core (TDD): `stageMultiplier`; `scoreWeek` throws on a missing multiplier; `scoreYear` — lock swaps (missed,
  injured, used), skipped week uses nothing, pending blocks later weeks, injured-no-stats week doesn't use the
  athlete, degradation counts stages not weeks, late joiner, bye, cross-stage round robin continues, reopen →
  pending; settings parse new keys and reject removed ones; simulator still runs.
- DB (PGlite): week lock times across the DST change (Oct 19 21:00 EDT = 01:00Z, Nov 2 21:00 EST = 02:00Z);
  `WEEKS_HAVE_PICKS`; `set_pick` codes; picks RLS before/after the lock; cleared confirmed injuries readable by the
  league; `grant_stage_allowance` rank validation and amounts; rpc-gate covers the new admin RPCs; settings rewrite.
- App: `weekly.ts` row mapping; tally hold → undo of own latest tap only.

## Out of scope

Live provisional scores from unlocked stats, email notices, per-athlete season pages, trades.
