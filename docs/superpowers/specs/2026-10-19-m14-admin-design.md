# M14 — Admin power overhaul (design)

Date: 2026-10-19. Base: main 8aba073 (M13 shares live). Branch `m14-admin` (worktree `Tribe-Fantasy-m14`).
Status: agreed in chat 2026-10-19, awaiting the user's review of this document.

## 1. Why

The app was built member-first, so admins keep hitting walls: an admin with no team sees no league at all, nobody can
remove a problem account, and players only ever reach a roster when share buying closes. The user is the admin and
**does not play** (their teams are for testing only), so admins need to see and fix anything — "full power in a clean
manner".

## 2. Goals

1. Admins can look inside **every league** in the season, sealed information included.
2. Admins can **give and take players** (a share % of a player) on any team, any time.
3. Admins can **remove a problem account**.
4. Admins can **rename a team** and **fix a display name**.
5. Admins can **read the history** of every admin action.
6. All of it lives in the **Admin tab**, laid out the same way everywhere ("standardized").

## 3. Non-goals

- **Acting for a manager** — no admin picks, no admin share buys or cancels. User: "it's on the manager"; auto-pick
  already covers an absent manager.
- **Moving a team to another league** — remove + rejoin covers it (my call; not objected to).
- **Blocking a removed person's email** — "removing them once is enough"; they may sign up again.
- **Team rename for owners** — that's M15.
- Anything on the League / Stats / Tally screens beyond what §5.6 needs. Admin powers do not appear as extra buttons on
  member screens.

## 4. Anti-goals (fails even if it works)

- An admin action with a hidden side effect. User rule: **admin actions are deliberate and separate.** Giving shares
  never touches credits; credits change only through Adjust credits.
- A destructive action with neither an undo nor a confirmation that names exactly what it affects.
- Keepers or treasurers gaining the new sealed-information access (it is **admin only**).

## 5. What gets built

### 5.1 Admin tab layout

Tabs, most-used first (order is my call): **Tournaments · Leagues · Users · Wallets · Athletes · Settings · History ·
Backup**. The Keepers tab folds into Users (roles are shown and granted per person there) — my call, it is the same
list of people.

### 5.2 Leagues → league browser

- The tab lists the season's leagues (name, teams n/max, password yes/no). Create league, invite codes and Delete
  league keep working as today.
- Opening a league shows what its members see, plus more:
  - every team: team name, **owner's real display name** under it, credits balance, standings place/record;
  - each team's **roster with share %** (e.g. "Sam Grossberg · 25%");
  - the current tournament's games and pairings;
  - **sealed information**: share buys before buying closes (team, player, credits) and next-game picks before the
    game starts.
- Team actions, next to the team:
  - **Rename team** (same name rules as joining: `clean_name`, 60 chars). Undo = rename back. Logged.
  - **Remove from league** is NOT here — removing is per account (§5.3).

### 5.3 Users (new tab)

- List of every account: display name, email, teams (league + team name), roles (admin / stat keeper / treasurer),
  linked player if any. Search box by name or email (my call; the list can reach ~80 people).
- **Edit display name** (same rules as `set_display_name`). Undo = edit back. Logged.
- **Roles**: grant/revoke as the Keepers tab does today, incl. the existing last-admin guard.
- **Remove account** — for problem accounts. No undo, so a confirmation names everything affected, e.g.:
  > Remove **Alex Kim** (alex@…)? Their team **Gimp Zeal** leaves **League A**: it keeps the points it has, forfeits
  > its remaining games and stops being paired. Their 2 donations ($30) stay in the records. Their player profile
  > **Alex Kim** stays, unlinked. They can't sign in. This can't be undone.
  - The confirm button is disabled for your own account and for the last admin.
  - Effects:
    1. The person can no longer sign in; they may sign up again later as a new account.
    2. Each of their teams **stays** in past games and standings, shown as "<team> (removed)", and keeps points
       already earned.
    3. A removed team **forfeits games already paired** that haven't started (it scores nothing; the opponent plays
       against no picks) and is **not paired** in later games (Swiss gives the bye as usual). It cannot pick, buy or
       receive emails.
    4. Donations stay in the ledger and still count on the Donors list as "Removed user".
    5. A linked player profile stays (its stats are real), unlinked from the account.
    6. Logged with the team names and counts.

### 5.4 Give / remove players (in the league browser, per team)

- **Add player**: pick a player (season's opted-in players) + a share % (1–100, whole numbers) → Add.
- **Edit %** in place; **× remove**. Add and remove undo each other, so no confirmation.
- **Free**: no ledger row, no balance check. Stored as a `roster_slots` row (share = % / 100, price 0, a new `via`
  value such as 'admin'). Editing or removing works on ANY slot of that team, bought ones included — still no refund
  or charge (credits only via Adjust credits).
- **Other teams untouched**: their shares of that player stay as they are; the league total may pass 100%.
- **Roster limit**: admins may go past `roster_size`; the UI shows a warning ("7 of 6 players"), never blocks.
- **Timing**: works any time, also mid-tournament; changes count from the next game that starts. Removing a player
  that the team picked for the next game drops that pick (auto-pick fills at the start as usual). Games already
  started keep the roster they started with (my call: scoring must not rewrite finished games).
- Works for the tournament whose shares are current (the one the League tab shows); no tournament with settled
  rosters yet → the add form explains "Close share buying first" (my call).
- Logged: team, player, old %, new %.

### 5.5 History (new tab)

- Newest first, paged (50 at a time): when, who (display name), what, plain-words summary from the action + details
  ("Gave Sam Grossberg 25% to Gimp Zeal", "Removed account Alex Kim"). Filter by action type (my call).
- Reads the existing `audit_log`; every M14 action writes to it via `private.audit`.

### 5.6 Member-facing side effects (only what removal needs)

- A removed team's name shows as "<team> (removed)" wherever team names appear (standings, games, all-leagues board).
- Removed teams don't count toward a league's member count (a new person can take the spot) — my call.

### 5.7 Copy clean-up

Leftover admin-only "bids" / "auction" wording (AthletesPanel, LeaguesPanel, SeasonsPanel, `ATHLETE_IN_USE` text in
errors.ts) → share-buying words, per DESIGN.md "Words".

## 6. Constraints

- **Database**: one migration `0024_admin_powers.sql`, pasted by the user in the Supabase SQL editor before the push
  (new bundle calls new RPCs). Additive where possible; wrapped in begin/commit.
- **Account removal vs cascades**: today `memberships.user_id` is `NOT NULL ... ON DELETE CASCADE` to `auth.users`, so
  deleting an auth user would wipe their teams, ledger, pairings and picks — exactly what §5.3 forbids. The builder must
  change that (e.g. nullable `user_id` + `removed_at` on memberships, set before the auth user is deleted) and check
  every other `auth.users` FK (profiles cascade, user_roles cascade, donor_prefs cascade are fine; `stat_taps.keeper_id`
  is NOT NULL with NO on-delete action and would block deleting anyone who ever tallied — keep the taps, e.g. make it
  nullable + set null).
- **Deleting the auth user** happens inside a security-definer RPC (`delete from auth.users`), admin-only — no service
  key in the browser, no new Edge Function (my call; the SQL route needs no secret).
- **Sealed access**: `bids_read` and `game_picks_read` get an extra `public.is_admin()` clause. The existing "any role"
  clause (keepers/treasurers) stays limited to after close / after start.
- **Every new RPC**: `private.require_admin()`, stable error codes in `errors.ts`, `private.audit(...)`, grants re-run,
  covered by the pg_proc-driven RPC gate test.
- **Rosters are per tournament, not per game** today (`roster_slots` by stage, read by `loadTournamentRows`), so a
  mid-tournament edit would silently rescore finished games. The builder adds a "from game N" notion (e.g. the slot
  remembers the first game it counts for / the game it stopped at) so started games keep their roster.
- **Scoring is in the browser** (`scoreYear` / tournament core): removed-team forfeit and "roster as of game start"
  must be computed there from readable rows, not stored scores.
- UI follows DESIGN.md + tokens.css (dark default, light theme, Archivo Narrow caps buttons, few small words).
- Standing rules for this and later milestones: every change considers admin power; destructive = undo or a
  specific confirmation.

## 7. Destructive actions in M14

| Action | Undo | Confirmation |
| --- | --- | --- |
| Remove account | none | yes — names teams, leagues, donations, player profile |
| Remove player from roster | Add again | no |
| Change share % | Change back | no |
| Rename team / edit display name | Rename back | no |
| Revoke role | Grant again | no (last-admin guard stays) |

## 8. Left to the builder

- Exact SQL shape (tables/columns for removal, roster-at-game-start mechanism, RPC names and signatures).
- Component split of the league browser (reuse League-tab pieces where they fit).
- Test plan: PGlite DB tests for every RPC + RLS change, app tests for each new panel, core tests for forfeit/bye and
  roster-at-start scoring.
- Go-live runbook entry in docs/setup-supabase.md (0024).
