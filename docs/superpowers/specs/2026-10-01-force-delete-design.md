# Admin force-delete of athletes and sessions — design

Status: approved in chat 2026-10-01. Branch `force-delete`. Board task t81 (phase p14, URGENT).
Goal: an admin can delete any athlete or any session no matter what — tallied, verified, locked, bid on,
rostered or picked. Keepers keep the M8.5 limits (empty, unverified, own session).
One migration `0011_force_delete.sql`.

## 1. SQL

Both functions are dropped and recreated with a trailing `p_force boolean default false` (adding a parameter with
`create or replace` would leave the old signature behind as an overload). Grants are redone as in 0010:
revoke from `public, anon`, grant to `authenticated`. The one-argument call still resolves through the default,
so the live site keeps working once 0011 is pasted and before the new build deploys.

### `delete_athlete(p_athlete uuid, p_force boolean default false)`
- `require_admin`; lock the athlete row; `NOT_FOUND` if missing.
- `p_force = false`: exactly as 0010 (`ATHLETE_IN_USE` if any taps, stat lines, attendance, injuries, bids, roster
  slots or picks reference it).
- `p_force = true`: before deleting, for every `roster_slots` row of this athlete with `price > 0`, insert a
  `credit_ledger` row `(membership_id, stage_id, kind 'adjustment', amount +price, note 'Refund: <name> removed',
  created_by auth.uid())`. Then delete the athlete (every FK cascades).
- Audit `delete_athlete` with `{season_id, name, user_id, force}` plus, when forced, the counts removed:
  `taps, lines, attendance, injuries, bids, slots, picks, refunded` (refunded = total credits refunded).

### `delete_session(p_session uuid, p_force boolean default false)`
- `p_force = false`: exactly as 0010 (`require_keeper`, creator-or-admin, `SESSION_VERIFIED`, `SESSION_NOT_EMPTY`).
- `p_force = true`: `require_admin` (non-admins → `FORBIDDEN` via require_admin's existing code); lock the row;
  `NOT_FOUND` if missing; ignore verified, the 48 h lock and taps. Delete (taps, stat lines, attendance cascade).
- Audit `delete_session` with `{season_id, kind, held_on, force}` plus, when forced, `verified` (bool) and the
  counts `taps, lines`.
- Taps still queued on a phone for a deleted session get `NOT_FOUND` and are dropped (unchanged behaviour).

### Consequences (accepted by the user)
Scoring replays from stat lines and picks in the browser, so a forced delete changes past week results and
standings. A deleted rostered athlete leaves that roster slot empty for the rest of the stage; deleted picks count
as missed picks for those weeks. The audit row is the record of what went.

## 2. UI

- `rpc.ts`: `deleteAthlete(id, force = false)`, `deleteSession(id, force = false)` pass `p_force`.
- **Admin → Athletes → Remove** (`AthletesPanel.tsx`): keep the current confirm and safe call. If it fails with
  `ATHLETE_IN_USE`, show a second `window.confirm`: "<name> has stats, bids, roster spots or picks. Deleting
  removes all of it, refunds auction credits, and can change past results and standings. Delete anyway?"
  Yes → `deleteAthlete(id, true)`. No → nothing happens, no error shown.
- **Stats → session page** (`SessionPage.tsx`): admin-only "Delete session" button (secondary). One confirm:
  "Delete the <title> session and all its stats? Past results and standings can change. This can't be undone."
  Yes → `deleteSession(id, true)`, then navigate to `/stats`. Errors in the page's existing error line.
- Tally picker unchanged. Rules page unchanged.
- `errors.ts` `ATHLETE_IN_USE` text stays (keepers never see it; admins see the second confirm instead).

## 3. Testing

- DB (`tests/db/rpc-qol.test.ts`, extend):
  - force athlete with taps, lines, bids, a priced slot, a fill slot (price 0) and picks: all gone, one refund row
    for the priced slot only, balance restored by the price, audit counts right;
  - force athlete by a non-admin keeper → refused;
  - force session that is verified, past its lock, with taps and lines: gone, audit counts right;
  - force session by a keeper (even its creator) → refused;
  - no-force calls still raise `ATHLETE_IN_USE` / `SESSION_VERIFIED` / `SESSION_NOT_EMPTY` as before.
- `rpc-gate.test.ts` picks up the new signatures from pg_proc (anon refused).
- App: AthletesPanel second-confirm flow (decline → no force call; accept → force call); SessionPage button
  only for admins and calls force.

## 4. Go-live

User pastes `0011_force_delete.sql` into tribe-dev (safe any time: the old site's one-argument calls still work),
then merge + push, tag `m8.6`, tick board t81.
