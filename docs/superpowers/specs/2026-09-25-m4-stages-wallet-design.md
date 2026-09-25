# M4: stages and wallet

Agreed with the user on 2026-09-25. It builds §1–3 and the M4 row of §9 in `2026-09-25-year-stages-revision.md`,
and amends §5.9 of `2026-09-25-tribe-fantasy-design.md` where they conflict.

## 1. Data (migration `0006_stages_wallet.sql`)

**`stages`**: `id`, `season_id` (cascade), `name` (1–60 chars, unique per season), `starts_on date`,
`ends_on date` (check `ends_on >= starts_on`), `tournament text` (optional name of the tournament the stage ends
at), `created_at`. Every signed-in user can read stages, the same as `seasons`. Stages in the same season must not
overlap; the RPCs enforce this.

**`credit_ledger`**: `id bigint identity`, `membership_id` (cascade), `stage_id` (nullable; cascade, which only fires when
the stage's whole season is deleted, since no RPC deletes a stage), `kind`
(`allowance` | `donation` | `adjustment`; M5 adds `bid`), `amount int` (non-zero), `dollars numeric(10,2)` (set
only for donations, > 0), `note text` (≤ 200 chars), `created_by`, `created_at`.

- It is append-only. The only fix for a mistake is an `adjustment` entry.
- Balance = the sum of a membership's entries. The client sums them. M5 adds a SQL `balance()` helper for bids.
- A unique partial index on `(membership_id, stage_id) where kind = 'allowance'` means one allowance per stage.
- RLS: an entry is readable by the owning member, treasurers and admins. Clients never write.

The migration also removes the retired settings keys from stored seasons: `min_credits_to_play`, `free_entry` and
`extra_credit_cap`.

## 2. RPCs

All are security definer, raise stable error codes and write the audit log, like `0003`.

| RPC | Who | Behaviour |
|---|---|---|
| `create_stage(season, name, starts_on, ends_on, tournament)` | admin | `NOT_FOUND`, `INVALID_NAME`, `INVALID_DATES`, `STAGE_OVERLAP`, `STAGE_EXISTS` |
| `update_stage(stage, name, starts_on, ends_on, tournament)` | admin | same checks, excluding the stage itself from the overlap test |
| `grant_stage_allowance(stage) → int` | admin | credits every membership in every league of the stage's season that has no allowance for this stage yet; returns how many it credited |
| `record_donation(membership, dollars, note) → bigint` | treasurer or admin | `DONATIONS_DISABLED` unless `donations_enabled`; `INVALID_AMOUNT` unless 0 < dollars ≤ 10 000; credits `round(dollars × credits_per_dollar)` |
| `adjust_credits(membership, amount, note) → bigint` | admin | `INVALID_AMOUNT` if 0; `NOTE_REQUIRED` if the note is blank |
| `join_league` (changed) | member | `LEAGUE_FULL` when the league already has `max_members` memberships (count taken under the invite row lock) |

**Allowance amount.** In each league, `n` is the member count and `r` is the member's rank by
`private.standings_points(membership)`, with 1 as the best. Tied members share the average of their ranks. The
amount is `round(allowance_base + allowance_gap × (r − 1) / (n − 1))`, or `allowance_base` when `n < 2`.
`standings_points` is a stub that returns 0 until M6 builds standings, so every member gets
`base + gap / 2` = 115. Re-running the grant is safe. It only credits memberships that joined after the last run,
ranked among everyone in the league. SQL reads settings with `coalesce` defaults that mirror `DEFAULT_SETTINGS`,
following the existing pattern.

## 3. Donations are to the team

Every donation is a **donation to the team fund**. The app never holds or moves money. Wording used everywhere:

- The admin form is titled **"Record a donation to the team"** and explains that the treasurer has already
  received the money through the official team channel.
- A ledger row is labelled **"Donation to the team — $X"**.
- The wallet card says credits are a thank-you for supporting the team, with no cash value and no refunds.

Donation recording stays off in the beta (`donations_enabled` false) until the legal sign-off. The member-side
"intent" flow in the original §5.9 is dropped. The treasurer records confirmed donations directly.

## 4. Settings (`src/core/settings.ts`)

- Add `max_members` (default 6, 2–50, integer), `allowance_base` (100, 0–100 000, integer), `allowance_gap`
  (30, 0–100 000, integer) and `donations_enabled` (false).
- Change the `roster_size` default from 5 to 4.
- Remove `min_credits_to_play`, `free_entry` and `extra_credit_cap`. The simulator's starting budget becomes
  `allowance_base` plus a random extra.
- The decay and trade settings are cleaned up in M6, along with the decay rewrite.

## 5. UI

- Admin console:
  - A **Stages** section under each season lists stages and has an add/edit form and a
    **Grant allowance** button, which reports "credited N".
  - A **Wallets** section per league lists members and balances, with the adjustment form. The donation
    form appears only when `donations_enabled` is on.
- Home: a **wallet card** for each of the user's teams, showing the balance and the entry history (kind, amount,
  note, date).
- No separate treasurer page yet. The RPC accepts treasurers; add a page when one is named.

## 6. M3 follow-ups folded in

1. The TallyPage `queued` memo also filters `queue` by `savedIds`. Undo sends a real undo when its target is
   already saved, so a reopened board can't forget or double-count a tap.
2. AuthProvider resets its state when the session's user id changes, before a failed fetch can leave the
   previous user's roles showing.
3. The session picker no longer lists a queued session from an old season. Before, it showed that session with
   the current season's athletes. This was a display bug only.
4. Taps rejected with `SESSION_VERIFIED` are dropped as now. The board already shows "N taps not saved: This
   session is already verified…" (M3), so no change is needed.

## 7. Tests

PGlite tests in `tests/db`:
- Allowance math: ties, `n < 2`, rounding.
- Re-running the grant only credits late joiners.
- `STAGE_OVERLAP`.
- `LEAGUE_FULL`.
- The donation gate and the treasurer/admin roles.
- `adjust_credits` rules.
- Ledger RLS: a member can't read another member's entries, and non-members read nothing.
- The guard tests extended to `stages` and `credit_ledger`: no client writes, and anon gets nothing.

Core tests cover the new settings. UI changes follow the existing component tests where a page already has them.

## Out of scope

Bid deduction, auction dates on stages and the athlete-supply check are M5. Standings are M6. The donor board is
out. The fund isn't being raised in the beta.
