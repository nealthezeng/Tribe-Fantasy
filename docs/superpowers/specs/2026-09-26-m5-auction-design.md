# M5: stage auction

Agreed with the user on 2026-09-26. It builds the M5 row of §9 in `2026-09-25-year-stages-revision.md` and replaces
§5.5 of `2026-09-25-tribe-fantasy-design.md` where they conflict. It also closes the M5 gates listed at the end of
`docs/superpowers/plans/2026-09-25-m1-m2-foundation-and-core.md`.

## 1. Decisions

- **One sealed round per stage, then a random fill.** There is no leftover bidding round.
- **The auction runs in the database.** An admin-only RPC allocates, deducts, fills and writes rosters in one
  transaction. There is no browser job and no Verify button, because balances stay private (M4). Transparency comes
  from publishing every bid after close, the rosters with prices, and the fill seed.
- **Bids are sealed until close.** Before close a manager sees only their own bids. After close the league sees every
  bid.
- **The fill never deals an injured athlete.** Injured means a keeper-confirmed injury that is not cleared
  (`confirmed_at is not null and cleared_at is null`) when the auction runs. Managers may still bid on injured
  athletes.
- **Spots the fill can't cover stay empty for the stage.** The team plays short. The no-repeat pick cycle resets
  sooner, which M6 handles.
- The auction always allocates exclusively (one owner per athlete per league). `exclusive_ownership = false` is not
  supported; the setting stays for later. `allow_self_ownership` is honoured.

## 2. Data (migration `0007_auction.sql`)

**`stages`** gains:
- `bid_close_at timestamptz` — null until the auction opens.
- `auction_seed text` — random (`gen_random_uuid()::text`), set once by run_auction (not at open, so the fill order can't be worked out while bids are sealed), never changed. Readable by everyone who can read stages.
- `auction_run_at timestamptz` — set once by the run.

The old `seasons.bid_close_at` and `seasons.leftover_bid_close_at` columns stay but are unused.

**`bids`**: `id uuid`, `stage_id` (cascade), `membership_id` (cascade), `athlete_id` (cascade), `amount int`
(≥ 0), `placed_at timestamptz` (database clock), unique `(stage_id, membership_id, athlete_id)`.
Editing a bid updates `amount` and resets `placed_at`.

**`roster_slots`**: `id uuid`, `stage_id` (cascade), `membership_id` (cascade), `athlete_id` (cascade),
`league_id` (denormalised from the membership, for the unique index), `price int` (≥ 0), `via` (`bid` | `fill`),
`created_at`. Unique `(stage_id, league_id, athlete_id)` (a membership belongs to one league, so this also means
one slot per athlete per team).

**`credit_ledger`**: the `kind` check gains `bid`. A won bid writes one entry of `-price` with the stage id.

**RLS**
- `bids`: the owning member reads their own at any time. Once `now() >= bid_close_at`, every member of that league
  and staff read all of the league's bids. Before close, staff (admins included) can't read other people's bids,
  and the `place_bid` audit row leaves out the amount, because admins read the audit log. Anon reads nothing.
- `roster_slots`: readable by members of the league and staff.
- Clients never write either table. The guard tests cover both.

**Helpers**
- `private.balance(membership) → int` = sum of the membership's ledger entries.
- `private.is_injured(athlete) → boolean` per §1.
- `private.owns_athlete(user, athlete)` gets its real body: true when one of the user's memberships holds a
  `roster_slots` row for the athlete in the latest stage (by `starts_on`) of the athlete's season whose
  `auction_run_at` is set.

## 3. RPCs

All are security definer, raise stable error codes and write the audit log, like `0003` and `0006`.

| RPC | Who | Behaviour |
|---|---|---|
| `open_auction(stage, close_at)` | admin | Sets `bid_close_at`. `NOT_FOUND`; `AUCTION_ALREADY_RUN`; `BID_CLOSED` if the current close time has passed; `INVALID_CLOSE_TIME` unless `close_at > now()`. Runs the supply check (below). Calling it again before close moves the close time. |
| `place_bid(stage, membership, athlete, amount)` | member who owns the membership | Upsert. `NOT_MEMBER` if the caller doesn't own the membership or it isn't in the stage's season; `AUCTION_NOT_OPEN` if `bid_close_at` is null; `BID_CLOSED` if `now() >= bid_close_at`; `NOT_OPTED_IN` unless the athlete is in the season and opted in; `SELF_OWNERSHIP` if `allow_self_ownership` is false and the athlete's `user_id` is the caller; `INVALID_AMOUNT` unless `min_bid ≤ amount`; `INSUFFICIENT_CREDITS` if `amount > balance`. |
| `delete_bid(stage, membership, athlete)` | same member | Same open/closed and membership checks; deleting a missing bid is a no-op. |
| `run_auction(stage) → jsonb` | admin | Locks the stage row. `NOT_FOUND`; `AUCTION_NOT_OPEN`; `AUCTION_NOT_CLOSED` if `now() < bid_close_at`; `AUCTION_ALREADY_RUN`. Sets the `auction_seed` if not yet set. Allocates every league of the season (below), sets `auction_run_at`, audits, and returns `{by_bid, by_fill, empty}`. |

**Supply check** (in `open_auction`): for every league of the season, `memberships × roster_size` must be
≤ the season's opted-in athletes that are not injured. Otherwise it raises `NOT_ENOUGH_ATHLETES` with the league
name in the message detail.

**Allocation**, per league, inside `run_auction`:
1. Candidate athletes: opted in, in the season. Budgets: each membership's `private.balance` at run time. Open
   slots: `roster_size` each.
2. Bids of the league's memberships for this stage, on candidate athletes, excluding self-owned ones, sorted by
   `amount desc, placed_at asc, id asc`. For each: skip if the athlete is taken in this league, the roster is full,
   or the remaining budget < amount. Otherwise insert a `roster_slots` row (`via = 'bid'`, `price = amount`), a
   ledger `bid` entry of `-amount` (skipped when amount is 0), and reduce budget and open slots.
3. Fill: unclaimed candidate athletes that are not injured, ordered by `md5(auction_seed || ':a:' || athlete_id)`;
   managers with open slots ordered by `md5(auction_seed || ':m:' || membership_id)`. Deal one athlete per manager
   per pass at price 0 (`via = 'fill'`), skipping a self-owned pairing, until athletes or open slots run out.
4. Remaining open slots are counted as `empty`.

This matches `allocate()` in `src/core/allocation.ts` for step 2. The fill intentionally differs from
`fillLeftovers()` (md5 ordering instead of the seeded shuffle); `src/core` stays the simulator's model.

A membership that joins after the run has no roster until the next stage.

## 4. UI

Follows `DESIGN.md` and `tokens.css`. No new tab.

**League tab (Home) — a stage card per team**, for the stage of the team's season whose auction opened most recently
(latest `bid_close_at`), or the latest stage by `starts_on` before any auction opens. Creating next stage early
must not hide this stage's rosters.
- No `bid_close_at`: "Auction not open yet".
- Open: countdown to close, balance, list of opted-in athletes with an amount input and Save/Remove, an "injured"
  tag where it applies, and "Bidding on N athletes, total X credits". A note says the total may exceed the balance
  but you only win what you can afford. The member's own athlete is shown without an input.
- Closed, not run: "Bids are closed. Rosters appear here once the auction runs.", plus all league bids per team.
- Run: your roster (athlete, price, bid or fill); every team's roster and the full bid list, one expandable list per
  team; the seed. A late joiner sees "You joined after this stage's auction; your roster starts next stage."

**Admin tab — Stages section**, per stage:
- Open auction: a `datetime-local` input and button. Errors show inline (the supply error names the league).
- Status: not open / open (closes at …) / closed (ready to run) / ran at …. No bid count: staff can't read sealed bids.
- Run auction: enabled after close; confirms, then reports "Awarded N by bid, M by fill, K spots left empty".

**Tally screen**: a keeper's own rostered athletes are greyed out, not tappable, labelled "on your team". The
server check stays as the safety net.

Every new error code gets a plain message in `src/app/lib/errors.ts`.

## 5. M5 gates (from the M1+M2 plan)

With `owns_athlete` real:
- `save_taps`, `verify_session`, `confirm_injury` already call it — add `OWNS_ATHLETE` tests for each.
- `reopen_session` blocks a caller who owns any athlete with taps or lines in the session.
- `set_attendance` by a keeper and `correct_stat_line` by an admin raise `OWNS_ATHLETE` for an owned athlete.
  A player setting their own attendance is unaffected.
- `report_injury` does not auto-confirm when the reporting keeper owns the athlete.

## 6. Tests

PGlite tests in `tests/db`:
- Bids: every error code in §3, edit resets `placed_at`, delete, `SELF_OWNERSHIP` honours the setting.
- Visibility: own bids only before close, league bids after close, rosters to league members, nothing to
  non-members or anon.
- Run: bid tie → earlier `placed_at`, unaffordable skip, full-roster skip, ledger `bid` entries equal prices,
  second run → `AUCTION_ALREADY_RUN`, run before close → `AUCTION_NOT_CLOSED`.
- Fill: never an injured athlete, empty slots when healthy athletes run out, same seed → same result, two leagues
  sharing one athlete pool each allocate independently.
- Cross-check: random drafts through `run_auction` and `allocate()` give the same bid awards.
- Supply check: `NOT_ENOUGH_ATHLETES`, injured athletes not counted.
- M5 gates in §5, and guard tests extended to `bids` and `roster_slots`.

UI: component tests where the page already has them; `errors.test.ts` covers the new codes.

## Out of scope

Degradation hints on the bid screen (M6), filling empty slots mid-stage, a leftover round, trades, dropping the
old `seasons` auction columns.
