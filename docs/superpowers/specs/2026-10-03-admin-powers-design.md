# Admin powers and opponent names: design

Status: design choices made by the user in chat 2026-10-03; this file awaits their review. Board tasks t120, t121,
t123 (phase p14). One migration `0014_admin_powers.sql`, additive and safe to paste before the deploy (section 5).
Shipped alongside the `m9-fixes` branch (t118 light mode, t119 name at sign-up, t122 games count on verify).

## Goal

1. **t120:** admins can tally and verify every game, including games with their own fantasy players and games they
   tallied themselves. Stat keepers keep both checks.
2. **t121:** admins can delete a tournament, and can undo ("delete") the latest played game of a tournament.
3. **t123:** keepers and admins can name each game after the real opponent ("vs Duke"); unnamed games stay "Game 3".

## 1. Admins tally and verify everything (t120)

Today two checks stop an admin who is also a manager:
- `OWNS_ATHLETE`: `private.owns_athlete(uid, athlete)` blocks taps (`save_taps`), `verify_session`,
  `reopen_session`, `correct_stat_line`, keeper attendance, and auto-confirming an injury.
- `VERIFIER_TAPPED`: `verify_session` refuses a keeper who has taps in the session.

**SQL.** `private.owns_athlete(p_user, p_athlete)` is redefined to return false when `p_user` has the `admin`
role (checked against `user_roles` by `p_user`, not `auth.uid()`, so the function stays correct for any caller).
That one change lifts the ownership gate from every caller above. `verify_session` is redefined with the
`VERIFIER_TAPPED` check skipped for admins (`public.is_admin()`); everything else in it is unchanged (copied from
0005). The `is_my_athlete` checks (a *player* acting on their own injury or attendance) stay: they're about being
the athlete, not owning them.

**App.**
- `TallyPage`: admins skip `loadOwnedAthletes`, so the tally board doesn't grey out their own players.
- `SessionPage`: an admin who tapped still sees Verify (the `iTapped` branch applies to non-admin keepers only).

**Unchanged.** Stat keepers keep both checks. The audit log already records who tapped and who verified. The
user accepted that an admin can tally and verify a game alone, with their own team in it.

## 2. Delete a tournament (t121)

`public.delete_stage(p_stage uuid) returns void`, admin only.
- `require_admin`; lock the stage row; `NOT_FOUND` if missing.
- Collect the stage's game session ids, delete the stage, then delete those sessions (taps, stat lines and
  attendance cascade). The stage delete cascades games, pairings, game picks, bench swaps, bids and roster slots.
- **Credits are kept** (user's choice): `credit_ledger.stage_id` changes from `on delete cascade` to
  `on delete set null`. Allowances, refunds and adjustments stay, so no balance moves. The one-allowance-per-stage
  unique index ignores null stage ids, so orphaned allowance rows don't clash.
- Audit `delete_stage` with `{season_id, name, games, sessions, slots, bids, ledger_rows_kept}`.
- Standings drop the tournament's games, because the browser recomputes standings from games.

**UI.** Admin → Tournaments: a "Delete tournament" button per tournament, folded away like the other rare actions,
with a confirm that names what goes ("its N games and their stats, rosters and bids; credits stay").

## 3. Delete (undo) the latest played game (t121)

Each Finish creates the next game, so a tournament's newest game is usually unplayed. "Delete game" therefore means
**reset the newest started game** back to not started (user's choice).

`public.reset_game(p_game uuid) returns void`, admin only.
- `require_admin`; lock the game; `NOT_FOUND` if missing; `GAME_NOT_STARTED` if it hasn't started;
  `NOT_LATEST_GAME` if a later game of the same stage has started.
- Delete the unstarted next game (number + 1) if this game's Finish created one (its pairings cascade).
- Delete the game's session (taps, lines, attendance cascade); set `started_at`, `finished_at`, `session_id` to null.
  The game keeps its number and frozen pairings, and managers' picks for it stay in place.
- Bench swaps stay (each records the game it applies from). Game 1's bench flags stay as Start set them.
- Audit `reset_game` with `{stage_id, number, session_id, verified, taps, lines, next_game_deleted}`.
- Undoing several games = resetting one at a time, newest first. Resetting game 1 leaves the tournament
  freshly opened.

**UI.** Admin → Tournaments: "Undo game N" on the tournament whose newest started game is N, with a confirm ("its
stats are deleted and it can be played again"). The tally page's live-game controls are unchanged.

## 4. Opponent names (t123)

- `games.opponent text check (length(opponent) between 1 and 40)`, null by default.
- `public.set_game_opponent(p_game uuid, p_name text) returns void`: keepers and admins (`require_keeper`);
  trims the name, empty → null; `NOT_FOUND` if missing. Any time, started or not. Audit `set_game_opponent`.
- One helper in `src/app/lib/stats.ts`: `gameLabel(number, opponent)` → `vs Duke` or `Game 3`. Every place that
  writes "Game {n}" uses it: `gameTitles` (Stats, Me, Tally list), `TournamentCard` (headline strip, next-game
  title), `GameControls` messages, the StagesPanel pairing check.
- **Where it's set:** an "Opponent" field in `GameControls` on the tally page for the next or live game, and in
  the admin Tournaments tab per game. Games load `opponent` with the rest of the row; the backup already includes
  every `games` column.

## 5. Migration and go-live

`0014_admin_powers.sql`: redefine `private.owns_athlete` and `public.verify_session`; swap the `credit_ledger`
stage FK; add `games.opponent`; create `delete_stage`, `reset_game`, `set_game_opponent`; redo grants as in 0012
(revoke from `public, anon`, grant to `authenticated`). Everything is additive or more permissive for admins, so the
user pastes 0014 into tribe-dev BEFORE merging, then merge + push. Tag `m10-admin`.

## 6. Tests

PGlite DB tests (`tests/db`):
- An admin who owns an athlete can tap, verify, reopen and correct that athlete's game; a stat keeper who owns
  one still gets `OWNS_ATHLETE`.
- An admin who tapped can verify; a keeper who tapped still gets `VERIFIER_TAPPED`.
- `delete_stage`: games, sessions, slots and bids are gone; ledger rows remain with a null stage and balances
  are unchanged; non-admin → `FORBIDDEN`.
- `reset_game`: the next unstarted game and the session go and the game is unstarted again; resetting an older
  game → `NOT_LATEST_GAME`; an unstarted game → `GAME_NOT_STARTED`; Start works again afterwards.
- `set_game_opponent`: keeper sets, blank clears, player → `FORBIDDEN`, 41 chars refused.
- The pg_proc RPC gate test covers the three new functions automatically.

App tests: `gameLabel` both ways; TallyPage doesn't grey an admin's own players; SessionPage shows Verify to an
admin who tapped.

## Out of scope

Restoring a deleted tournament (the Backup tab is the safety net: take one before deleting). Deleting a game from
the middle of a tournament. Renaming a tournament (`update_stage` already does it).

## Amendments (2026-10-03, from the verified build `admin-powers-verified-draft`)

1. **Where opponents are set:** only on the tally page's tournament card (`GameControls`, for the next or live
   game). Admins are keepers too, so the per-game field in the admin Tournaments tab was dropped as redundant.
   Staff screens say "Game 2 vs Duke" (the number keeps Start/Finish unambiguous); player screens say "vs Duke"
   (`gameLabel`). The admin "Check pairings" lines keep bare game numbers.
2. **Where the admin buttons live:** "Delete tournament" sits in the tournament's Edit form (Edit opens it);
   "Undo game N" sits in the folded Tournament section next to Check pairings.
3. **App tests:** the TallyPage/SessionPage admin exemptions are one-line conditions; the DB tests pin the real
   rules, so those two get no UI tests. StagesPanel gets tests for Undo (picks the newest STARTED game) and Delete.
4. **Undoing game 1 reopens bench choices** (`set_bench` only refuses once a game has started); pinned in a DB test.
5. **Branch base:** `admin-powers` is cut from `m9-fixes` (unmerged at plan time), so merging it ships m9-fixes too.

## Amendment (2026-10-06, board t125): deleting a tournament refunds auction spending

User reversed the "spending is not refunded" ruling. Migration `0015_refund_on_delete.sql` redefines `delete_stage`:
before deleting, each team gets one `adjustment` row `Refund: <tournament> deleted` equal to the prices of its priced
roster slots still in the tournament (not the `bid` ledger rows, so a force-deleted athlete already refunded by
`delete_athlete` is never paid twice). Allowances are not taken back; every existing ledger row is still kept. The
audit row gains `refunded`.
