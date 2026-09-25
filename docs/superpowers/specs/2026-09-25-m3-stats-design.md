# M3 Stats — design addendum

Supersedes spec §5.10 and the M3 row of §8 in `2026-09-25-tribe-fantasy-design.md`. Everything not
mentioned here is unchanged.

## 1. What changed from the original spec

| Original §5.10 | M3 decision | Why |
|---|---|---|
| Phone form + CSV import | Big-button **tally screen**; CSV **export** only | Coaches tally live at practice; no spreadsheet to import |
| Stat lines typed in | Stat lines derived from a **tap event log** at verify time | Lets two keepers tally at once without double counting |
| Attendance implied by a stat line | Explicit `attendance` (players mark their own) | User wants attendance tracked |
| — | `injuries`, reported by players, confirmed by staff | Injury changes picks (M6) |
| Score per point played | `normalize_mode = none` (raw totals) | Tracking points played is too tedious |
| 8 stats incl. completions | 5 stats | Fits one phone row; removes the time-matching grey area |

Players are **not** a new role: a player is a member whose account is linked via `athletes.user_id`.
Coaches get `stat_keeper`, not admin.

## 2. Settings changes (`src/core/settings.ts`)

- `stat_weights` default → `{ goal: 3, assist: 3, block: 3, callahan: 8, turnover: -2 }`.
  A callahan is one tap; its +8 already includes the goal and the block.
- `normalize_mode` default → `none`.
- New `tap_merge_seconds` (default 10, range 0–60). 0 disables cross-keeper merging.
- A tap's `stat` must be a key of the season's `stat_weights`.

## 3. Data model (migration `0004_stats.sql`)

```
sessions     id, season_id, kind practice|tournament, held_on date, counts bool default true,
             created_by, verified_by null, verified_at null
stat_taps    id uuid (client-generated, PK), session_id, athlete_id, stat text, delta smallint (-1|1),
             keeper_id, tapped_at timestamptz (skew-corrected), received_at timestamptz default now()
stat_lines   session_id, athlete_id, stats jsonb, points_played int not null default 0 check (points_played >= 0),
             PK (session_id, athlete_id)
attendance   session_id, athlete_id, status present|absent, set_by, set_at, PK (session_id, athlete_id)
injuries     id, athlete_id, reported_by, reported_at, confirmed_by null, confirmed_at null, cleared_at null
```

- **Locked is derived, not stored:** a session is locked when `verified_at + stat_lock_hours < now()`.
- Taps set attendance to `present` for that athlete if no row exists.
- An injury is **active** from `confirmed_at` until `cleared_at`. Unconfirmed reports have no game effect.

## 4. Merging taps (`src/core/taps.ts`, pure)

`mergeTaps(taps, tapMergeSeconds) → Map<athleteId, Record<stat, count>>`

1. **Undo:** each −1 cancels the same keeper's latest earlier uncancelled +1 for the same athlete + stat.
   A −1 with nothing to cancel is ignored. It never touches another keeper's taps.
2. **Cross-keeper dedupe:** the remaining +1s by *different* keepers for the same athlete + stat are
   paired one-to-one, nearest in time first, when `|Δt| ≤ tapMergeSeconds`. Each pair counts once.
   (A taps 2 goals and B taps 1 within the window → 2.)
3. Also returns the list of merged pairs so the verify screen can show them.

`ponytail:` greedy nearest-first pairing; may differ from optimal matching in rare 3-keeper tangles. Upgrade to
proper bipartite matching only if that ever happens.

**Clock skew:** each save carries the phone's `client_now`. The RPC shifts every `tapped_at` in the batch by
`now() − client_now`. This holds across long offline stretches as long as the phone clock does not jump.

## 5. RPCs (all security definer, audited, stable error codes)

| RPC | Who | Does |
|---|---|---|
| `create_session(season, kind, held_on, counts)` | keeper, admin | new session |
| `save_taps(session, client_now, taps[])` | keeper, admin | `insert … on conflict (id) do nothing`; rejects owned athletes, verified sessions, unknown stats |
| `set_attendance(session, athlete, status)` | keeper, admin, or the athlete's linked user | upsert |
| `report_injury(athlete)` / `clear_injury(athlete)` | keeper, admin, or linked user | open / close an injury |
| `confirm_injury(injury)` | keeper, admin | sets `confirmed_by/at` |
| `verify_session(session, lines[])` | keeper or admin with **zero taps in the session** who **owns none of its athletes** | writes `stat_lines`, sets `verified_*`; lines copied into the audit row |
| `reopen_session(session)` | keeper, admin; before lock only | deletes its `stat_lines`, clears `verified_*` |
| `correct_stat_line(session, athlete, stats)` | admin; after lock only | overwrites one line; audit row holds before/after; flags the week for rescore (M6) |

"Owns" = has a current `roster_slots` row for the athlete in any league of the season.

`ponytail:` the verifier's browser computes `lines` with `mergeTaps`. Any staff member can re-run it against the
taps to check the result, the same trust model as scoring. Move merging into SQL if a staff member is ever
not trusted.

**Error codes:** `FORBIDDEN`, `OWNS_ATHLETE`, `VERIFIER_TAPPED`, `SESSION_VERIFIED`, `SESSION_LOCKED`,
`SESSION_NOT_LOCKED`, `UNKNOWN_STAT`, `NOT_YOUR_ATHLETE`.

## 6. Visibility (RLS)

| Data | Readable by |
|---|---|
| `sessions` | league members + staff |
| `stat_lines` (exist only once verified) | league members + staff |
| `stat_taps` | keepers + admin |

Members see stats as soon as a session is verified. Until it locks, a reopen can still change or remove those
lines, so the UI marks unlocked lines "verified — locks <time>".
| `attendance` | league members + staff |
| `injuries` confirmed and active | league members + staff |
| `injuries` unconfirmed | keepers, admin, the reporting user |

Every new table gets an explicit `grant select … to authenticated` next to its policies, and the function
grant loop is re-run.

## 7. Screens

**Tally** (`#/tally`, keepers + admin, phone-first):
- **Top bar:** today's sessions + "New session"; sync status (`Saved ✓` / `N unsaved` / `Offline`);
  **Undo last tap**.
- **Player list:** opted-in athletes with search. Each card has the name, injury badge, present/absent toggle,
  and five buttons (≥48px, fits 375px wide), each showing its count.
- **Owned athletes:** greyed out with "you own this athlete".
- **Tap queue:** taps queue in `localStorage`. Autosave runs 3s after the last tap, when the connection
  returns, and on `visibilitychange` to hidden.
  - Network errors: the taps stay queued and retry.
  - Stable-code rejections: the taps leave the queue with a visible warning. Taps are never silently dropped.

**Player** (`#/me`, members linked to an athlete): Present/Absent for today's sessions; **Report injury** /
**I'm back**.

**Session detail** (keepers + admin): merged totals, per-keeper breakdown, merged pairs, attendance;
**Verify** / **Reopen** / (admin, after lock) **Correct**. Unconfirmed injuries show "reported — confirm?".

**Admin console:** link an athlete to a member account; **Download CSV** of the season's stat lines.

## 8. Deferred to M6 (add to the gates list)

- Injury pick rules: a free re-pick if the picked athlete has an active injury before `pick_lock_at`, and a week
  where the picked athlete had an active injury and no counted session doesn't use up the athlete.
- Rescore flow triggered by `correct_stat_line`.

## 9. Pitfalls

- **Stat-chasing (HIGH, worse with raw totals):** captains use `counts = false` for drills.
- **Keeper conflicts (HIGH):** handled by the owned-athlete block, the verifier rule, the lock and the audit log.
- **Self-reported injury (HIGH):** handled because only confirmed injuries have a game effect.
- **Self-reported attendance (LOW):** harmless while `absent_score = 0`. If it goes negative, "present with zero
  stats" beats absent. Keepers see attendance at verify time.
- **Heuristic merge (MED):** two real events by the same player and stat, tapped by different keepers within 10s,
  count once. This is rare for the 5 stats; tune `tap_merge_seconds` if it bites.

## 10. Testing

- **`src/core` (Vitest):**
  - `mergeTaps`:
    - merged within the window, not at window + 1s
    - two taps by the same keeper are never merged
    - undo cancels only the undoing keeper's own tap
    - 2 taps from A + 1 from B = 2
    - three keepers on one player
    - pairs are reported
  - settings: `tap_merge_seconds`, the new defaults
  - the tap-queue pure functions
- **`tests/db` (PGlite):**
  - **Gate:** one structural test calls every admin/keeper RPC as a plain member, expects `FORBIDDEN`, and
    checks each writes an audit row on success.
  - The `points_played >= 0` constraint.
  - RLS per §6.
  - Players can edit only their own attendance and injury.
  - `OWNS_ATHLETE`, `VERIFIER_TAPPED`, `SESSION_VERIFIED`, `SESSION_LOCKED`.
  - Re-sent tap ids insert nothing.
  - Skew correction.
