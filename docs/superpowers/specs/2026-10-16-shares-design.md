# M13 Shares: fractional ownership, 12-team leagues, 2v2 games

Status: DRAFT, 2026-10-16, awaiting user review. Branch `shares` off main 2178335. Migration `0023_shares.sql`,
go-live tag `m13-shares`.

## 1. Why

The user wants leagues of up to **12 teams**. With exclusive ownership a 12-team league needs 12 × roster players,
and the team has 23 opted-in players. So the sealed-bid auction (one owner per player per league) becomes a
**share purchase**. Each team's credits buy a fraction of a player and score that fraction of the player's points.
Rosters grow to 6 with no bench, and each game becomes **2v2**: each team starts 2 players.

Success: the CCCs tournament (Nov 7–8) runs on shares. Teams buy shares the week before, play 2v2 games on the
League tab, and standings come out right. The tally screen stays untouched.

## 2. Decisions (user, 2026-10-16)

1. **Shares replace bids.** Before each tournament, teams put credits on players during a sealed window, the way
   the auction works today. At close, for each player in each league:
   `shares = max(min_shares, total credits put on that player in that league)`, with `min_shares` = 20. A team owns
   `its credits / shares`.
   Example: 100 + 50 → 150 shares, owned 2/3 and 1/3. A lone 1-credit buy → 1/20, and the other 19/20 is owned by
   nobody.
2. **Every credit put in is spent.** No one wins or loses a player any more, so every buy is charged.
3. **At most 6 players per team per tournament** (`roster_size` = 6). The players a team bought into are its roster
   for that tournament.
4. **No random fill.** A team that bought into fewer than 6 players plays the tournament with fewer.
5. **Roster 6, no bench.** The bench and its injury swap are removed: every player a team owns can start. "If a
   player gets injured, they get injured."
6. **2v2 games.** Each team picks 2 of its players per game. Side score = Σ over its 2 starters of
   `share × player's game score × tiredness × degradation`. The higher side wins. Win/loss points, upset weighting,
   Swiss pairing, sealed picks and pre-selection are all unchanged.
7. **Two opponents may start the same player in one game.** Each side gets its own share of that player's score.
7b. **Swiss pairing depends on the tournament and the season.** Teams are still ordered by season standings, which
   never reset. Pairing minimises, in this order: (1) rematches **within this tournament**, (2) rematches from
   earlier this season, (3) distance in the standings. With 12 teams and 6–8 games, not every team meets every
   other in a tournament. The total-score tiebreak then matters more, which rewards blowout wins; the user accepts
   that.
8. **Player-facing word: "Buy shares"**: "Buy shares in Sam", "You own 66% of Sam". "Bid" and "auction" disappear
   from player-facing text.
9. **Max league size 12.**
10. **Timing:** build after the Oct 17–18 Feasterns tuning weekend. Live before CCCs share buying opens. **The user
    deletes the Feasterns tournament after tuning** (`delete_stage`), so no 1v1 tournament remains in the season.
    No code has to score old 1v1 tournaments.
11. Out of scope: retuning any number (allowance, stat weights, tiredness, `min_shares`, upset_k), trades, a shared
    credit pool, PWA.

## 3. Calls made by Claude (user may overrule)

- **C1 Ship target: live by Sun Nov 1** so share buying can open around Nov 2 and close before Nov 7. That matches the
  old plan of an auction Nov 2–5.
- **C2 Ownership gates:** owning *any* share counts as owning the player for the stat-keeper rules
  (`private.owns_athlete`: tap, verify, reopen, correct, keeper attendance). Admins stay exempt (0014). This falls
  out of `roster_slots` with no SQL change.
- **C3 Bench removal:**
  - Drop the `bench_size` setting (0023 strips it from stored settings).
  - Drop the `roster_slots.bench` column, the `bench_swaps` table, `set_bench`, `swap_bench` and
    `private.bench_count`.
  - Remove the game-1 bench default from `start_game`.
  - Drop the bench UI (Bench buttons, swap) and the `lineup` bench logic (a team's starters come from all its
    slots).
  - Remove `bench_swaps` from `BACKUP_TABLES`.
- **C4 Auto-pick** (missed or injured picks; an injured pick is still replaced at the start, as today): fill each
  empty starter slot, one at a time, with the most rested healthy player not already starting. Ties go to the
  highest `share × recent average` (the last 3 settled game scores, as today), then the lowest id. If every player
  is injured, use injured ones, as today.
- **C5 Credits that can't be covered at close** (an admin cut a balance after the buys): take a team's buys from
  largest to smallest (then earliest, then id) and drop any it can no longer afford. Pools are computed from the
  buys that survive. Dropped buys are not charged.
- **C6 Database and code names stay** (`bids`, `place_bid`, `run_auction`, `roster_slots`, `stage`), the same way
  `stage` stayed `stage` when players started seeing "tournament". Only player-facing and admin-facing text changes.
- **C7 Admin labels:** "Open auction" → "Open share buying", "Run auction" → "Settle shares". The "Bids close"
  field becomes "Buying closes".
- **C8 New settings** `min_shares` (int 1–100000, default 20) and `picks_per_game` (int 1–5, default 2). New
  check: `picks_per_game ≤ roster_size`. Defaults change to `roster_size` 6 and `max_members` 12.
  `exclusive_ownership` and `bench_size` are removed: shares are never exclusive, and `parseSettings` rejects
  unknown keys, so 0023 strips both from stored settings. A setting for `picks_per_game` also keeps 1-pick test
  fixtures valid.
- **C9 Pick email:** a team gets the "pick your players" email when its picks for the next game number fewer than
  `least(picks_per_game, its roster size)`. The claim-time re-check uses the same test, so a 1-player team isn't
  emailed every game.
- **C10 Supply check:** `open_auction`'s `NOT_ENOUGH_ATHLETES` (members × roster_size > healthy opted-in) is
  removed, because shares aren't exclusive. A 12-team league would need 72 players against today's 23. Opening with
  zero healthy opted-in players is still refused, with the same code.
- **C11 Swiss inputs:** `swissPairings(order, tournamentMeetings, seasonMeetings)`, compared lexicographically
  (decision 7b). The provisional JSON saved by `finish_game` and `open_tournament` gains `season_meetings`, and
  `meetings` becomes this tournament's only. "Check pairings" (`checkPairing`) re-runs with both. Older saved rows
  (Feasterns, deleted) don't need to re-check.

## 4. Data (`0023_shares.sql`)

Paste before the push. The old live bundle keeps working until the push, except picks: see §9.

- `roster_slots`
  - Drop `unique (stage_id, league_id, athlete_id)` and add `unique (stage_id, membership_id, athlete_id)`.
  - Add `share numeric not null default 1 check (share > 0 and share <= 1)`.
  - `price` stays as the credits paid, so the refunds in `delete_stage` (0015) and force-delete (0011) refund
    everything spent, unchanged.
  - New rows are always `via = 'bid'`.
- `place_bid`: refuses `TOO_MANY_PLAYERS` when the team already has buys on `roster_size` other players this
  tournament. The over-balance check (M8.5) and the self-ownership, opt-in and sealing rules stay.
- `run_auction` rewritten:
  1. Eligible buys: athlete opted in, not the buyer's own athlete, amount > 0. Then C5.
  2. Per (league, athlete) pool = `greatest(min_shares, sum(amount))`.
  3. One `roster_slots` row per surviving buy, with `price` = amount and `share` = amount / pool, plus one `bid`
     ledger row of −amount.
  4. No fill. Returns `{by_bid, empty}`, where empty = open spots summed over teams. The audit row records the
     same counts.
- `game_picks`: primary key becomes `(stage_id, game_number, membership_id, athlete_id)`.
- `set_game_pick(p_membership, p_stage, p_number, p_athletes uuid[])` replaces the pick set for that game. It takes 0
  to `picks_per_game` distinct athletes, each on the team's roster. It refuses `TOO_MANY_PICKS` and keeps every
  existing refusal and lock. The old 4-argument function is dropped.
- `start_game`: the game-1 bench default is removed (C3).
- `queue_pick_notice` (0016/0017) and `claim_outbox`: the "no pick" test becomes "fewer than `picks_per_game`
  picks" (C9). Email copy: "Pick your players for game N", "…Pick your 2 players on the League page, or we'll start
  your most rested healthy players for you."
- Bid-reminder email copy: "Buying shares closes in …" (24h and 2h).
- Settings: strip `exclusive_ownership` from every stored `seasons.settings`.
- Re-run the grant loop, and classify any new or changed RPC in `tests/db/rpc-gate.test.ts`.

## 5. Core (`src/core`)

- `settings.ts`: C8.
- `tournament.ts`:
  - `TournamentSlot` gains `share`.
  - A side holds `picked: string[]` and `athleteIds: string[]` (≤ `picks_per_game`; empty = forfeit), with
    per-athlete `share`, `tired` and `decay`, and a per-athlete score breakdown on final games.
  - Tiredness and degradation are per (manager, athlete) as today. Every starter counts as a start.
  - `notice` is set when any starter isn't the team's own pick (missed or injured), naming which. `inactive`
    goes away with the bench.
- `week.ts`: `scoreWeek` takes `picks: Record<manager, string[]>`. Side score = Σ `athleteScore × multiplier`, where
  the caller's multiplier for each (manager, athlete) includes the share (`share × tired × decay`). A missing
  multiplier is still a thrown error.
- `picks.ts`: `autoPick` per C4, filling N slots. `lineup` loses its bench logic (C3).
- `swiss.ts`: C11.
- `allocation.ts` copies the old `run_auction` (used by `simulate.ts` and `tests/db/auction-crosscheck.test.ts`):
  rewrite it to the §4 pool rule so the cross-check still compares core against SQL.
- `simulate.ts`, `scripts/tune.ts` and the PGlite dry-run test (`tests/db/dry-run.test.ts`) buy shares and play 2v2.
  They have to run, but their numbers are not tuned.
- Swiss is unchanged. Timed on 2026-10-16: 12 and 13 teams pair in about 1 ms per game.

## 6. App (DESIGN.md + tokens.css only; follow docs/frontend-principles.md)

- **League tab, buying card** (today's AuctionCard + BidControl):
  - Open: "Buy shares", a credits-per-player input on each opted-in player, "N of 6 players", credits left, and
    over-budget and too-many refusals in place.
  - After close: the team's roster as "Sam · 66% · 100 credits", plus each player's split across the league (who
    owns what %), shown to everyone.
- **Pick card and scoreboard:**
  - "Your picks" holds 2 names against "Their picks" (still hidden until the game starts).
  - Each roster row gets Pick / Your pick. A third pick is refused, and the UI asks you to clear one first.
  - Final scores show the side total. Game details list each starter's % and points.
- **Rules page:** rewrite "Credits and the auction" as "Credits and shares", plus the picks and scoring sections (a
  2-player, share-weighted example). Numbers come from settings, as today. Update the FAQ "Who can see what?" and
  the email answer.
- **Admin:** C7 labels. The Run result reads "N buys settled, M spots empty".
- **Leftovers of the old auction:**
  - Remove `by_fill` from `rpc.ts`, "Random fill" from the roster list and the StagesPanel result text.
  - Remove `NOT_ENOUGH_ATHLETES` wording from `errors.ts` if C10 makes it unreachable.
  - The `game_picks` key in `lib/backup.ts` gains `athlete_id`.
- **DESIGN.md Words:** add **share** and **Buy shares**.

## 7. Pitfalls

- **Deploy order:**
  - 0023 drops the 4-arg `set_game_pick`, so the old bundle's Pick button fails between paste and push. Paste and
    push together, with no game running.
  - Admins hard-reload open tabs afterwards: the old settings editor saves every key and can't hold the new ones.
  - After the push, the user sets the live season's stored `roster_size` 6 and `max_members` 12 in Settings. Stored
    values beat the new defaults. Today they are 4 and 6.
- **Feasterns must be deleted before go-live** (decision 10). Otherwise its games are re-scored as 2v2 with
  auto-picked second starters.
- **Tiredness with 6 players and 2 starters:** a team can rest each player 2 games, so the ×0.75 step still bites.
  Short rosters tire faster. Retuning is out of scope, but flag it in the tune output.
- **Small `min_shares` and allowance:** the 100–130 allowance buys 5–6 uncontested whole players at 20 each.
  Retuning is out of scope.
- CI runs in UTC: any new DB test near a date boundary uses the Eastern date.

## 8. Build order (suggested)

1. 0023 + DB tests (run_auction pools and C5, place_bid cap, set_game_pick array, notify, bench drop, open_auction supply check,
   settings strip, rpc-gate).
2. Core: settings, scoreWeek, tournament, picks, simulate, plus the dry run.
3. App: buying card, pick card and scoreboard, Rules, admin labels, DESIGN.md.
4. Docs: setup-supabase.md 0023 entry and the go-live runbook (§7).

## 9. Out of scope

Retuning, trades, a credit pool across teams, a second (1v1) scoring path, Swiss changes, PWA (t246–t249), the
Rules-page stat-weight mismatch seen on 2026-10-16 (block 5 in Settings, D +6 on Rules). That mismatch gets its own
board task.
