# M10 Quality-of-life II: email notifications

Board phase p15 (M10), tasks t200 (bidding closes soon) and t201 (pick for the next game). M10's scope grows as
the user adds tasks; this spec covers notifications only. Branch `m10-notify` (worktree `Tribe-Fantasy-m10`), cut
from `main` at 2b2d690 (admin-powers / 0014, live as tag m10-admin). Go-live tag `m10-notify`.

## 1. What the user decided (2026-10-05)

- **Email only.** No SMS (Twilio cost + US carrier registration), no web push, no team-chat bot.
- **Pick notice when game N finishes**, to every paired manager with no pick yet for game N+1. Also when a
  tournament opens (game 1).
- **Bid reminders 24 h and 2 h before `bid_close_at`**, to every league member, each saying how many bids
  they have placed.
- **On by default**, with an opt-out switch on the Me page and a link to it at the bottom of every email.

## 2. Architecture

This is the app's first server-side job. The original design said "no edge functions, no cron" (main spec §2);
this milestone amends that for notifications only. Scoring, pairing and the auction stay where they are.

```
pg_cron (every minute) --pg_net POST--> Edge Function `notify`
                                           |  direct Postgres connection (SUPABASE_DB_URL)
                                           |  1. select private.queue_bid_reminders()
                                           |  2. select * from private.claim_outbox(50)
                                           |  3. send each over Gmail SMTP (smtp.gmail.com:465)
                                           |  4. select private.mark_outbox(id, error)
game_pairings AFTER INSERT trigger ------> private.outbox   (pick notices, queued in the same transaction as
                                                             open_tournament / finish_game)
```

- **All "who gets what" logic is SQL** in migration `0016_notify.sql`, so it is covered by the PGlite DB tests.
  The Edge Function is a thin sender with no decisions in it.
- **No new public RPC for the sender.** The function talks to Postgres directly with the `SUPABASE_DB_URL`
  secret every Edge Function already gets, so `claim_outbox` / `mark_outbox` stay in the `private` schema and are
  never exposed through PostgREST.
- **`finish_game` and `open_tournament` are not redefined.** Pick notices come from a trigger on
  `game_pairings`, which both RPCs already insert into. That keeps 0016 clear of any SQL other branches touch.
- Every minute is about 43k function calls a month, inside the free tier's 500k.

## 3. Data (migration 0016)

```sql
alter table public.profiles add column notify_email boolean not null default true;

create table private.outbox (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  kind text not null check (kind in ('bid_24h', 'bid_2h', 'pick_next')),
  ref text not null,            -- bid: '<stage id>@<bid_close_at>'; pick: '<game id>'
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  tries int not null default 0,
  sent_at timestamptz,
  error text,
  unique (membership_id, kind, ref)
);
```

- **Keyed by membership, not user:** a manager in two leagues gets one email per league.
- **`notify_email` is visible to league members** (profiles RLS lets them read profiles). A reminder
  preference is harmless to show, so it doesn't get its own private table.
- **The unique key makes queuing idempotent.** Every enqueue is `insert … on conflict do nothing`, so a re-run
  of the job never sends a duplicate.
- **Moving the close time sends fresh reminders.** `ref` includes `bid_close_at`, so when an admin changes the
  close (`open_auction` again) the reminders go out again for the new time. Old unsent rows for the old time are
  dropped at claim time (§5).
- **Not in Backup.** The outbox is short-lived delivery state in `private`, not league data.
  `notify_email` rides along with `profiles`.

## 4. Queuing rules

**Bid reminders: `private.queue_bid_reminders()`, called by the sender on every run.** For every stage with
`bid_close_at > now()` and `auction_run_at is null`:
- `bid_close_at - now() <= 2 h`: kind `bid_2h`
- otherwise `<= 24 h`: kind `bid_24h`
- otherwise nothing yet.

Recipients are every membership in a league of the stage's season whose user has `notify_email` on (a missing
profile counts as on). Consequences:
- A close set less than 2 h away only ever sends the 2 h reminder.
- A close set 2–24 h away sends the 24 h reminder at once, then the 2 h one later.
- After an outage, nothing is sent for a close that has already passed.

**Pick notices: trigger `private.queue_pick_notice()`, AFTER INSERT on `game_pairings`, for each row.** For
`home` and `away` (skipped when `away` is null: a bye doesn't play), queue `pick_next` with ref = the game id
when:
- the manager has no `game_picks` row for (the game's stage, the game's number), and
- the manager's user has `notify_email` on.

The trigger fires for `open_tournament` (game 1) and `finish_game` (game N+1).
`reset_game` deletes the unstarted next game. Finishing again creates a new game id, so the new pairings get
fresh notices.

## 5. Sending

**`private.claim_outbox(p_limit int)`** returns `(id, email, subject, body)`. It takes rows where:
- `sent_at is null and tries < 3`,
- `claimed_at is null or claimed_at < now() - interval '5 minutes'` (a lease, so a crashed run is retried),
- `created_at > now() - interval '30 minutes'` (a late reminder misleads more than a missing one; a pick notice
  is useless once the game has started), and
- for bid rows, the stage's current `bid_close_at` still matches the ref and the auction hasn't run.

It locks them with `for update skip locked` (overlapping runs never share a row), sets `claimed_at = now()` and
`tries = tries + 1`, and joins the address from `auth.users.email`. Rows with no email are skipped.

**`private.mark_outbox(p_id bigint, p_error text)`:** a null error sets `sent_at = now()`; otherwise it records
the error, and the row is retried after the lease runs out, up to 3 tries.

**Edge Function `supabase/functions/notify/index.ts`:**
- Deployed with JWT verification **off**. It requires the header `x-cron-secret` to equal the `CRON_SECRET`
  secret, else it returns 401. Even if the secret leaked, the worst case is draining the outbox early, which
  only sends emails that were already due.
- Sends plain-text mail with nodemailer (`npm:` specifier) over `smtp.gmail.com:465` (Supabase blocks outbound
  587). Uses the secrets `GMAIL_USER` and `GMAIL_APP_PASSWORD`, the same Gmail account and app password already
  used for sign-in mail. From: `Tribe Fantasy <GMAIL_USER>`.
- Returns `{ queued, sent, failed }` JSON so a manual invoke shows what happened.

**Gmail limit:** 500 messages a day. Worst case per tournament day is about 6 managers × 6 games = 36 pick
notices, plus reminders. Fine.

## 6. Email text

Times are shown in Eastern time, as everywhere else in the app (`America/New_York`). The site URL is a constant
in SQL: `https://nealthezeng.github.io/Tribe-Fantasy/`.

- **bid_24h / bid_2h:**
  - Subject: `Bidding for <stage> closes in 24 hours` (or `2 hours`)
  - Body: `<team>: bidding for <stage> closes <Mon Nov 2, 9:00 PM> ET. You have placed <n> bid(s).`, then the
    League link.
  - With 0 bids the line reads `You haven't placed any bids yet.`
- **pick_next:**
  - Subject: `Pick your player for game <n>` (`… game <n> vs <opponent>` when `games.opponent` is set)
  - Body: `<team>: game <n> of <stage> is next. You play <opponent team>. Pick your player on the League page,
    or the best rested player will be picked for you.`, then the League link.
- **Footer on every email:** `Turn these emails off: <site>#/me`.

## 7. App changes

- **Me page:** an "Email reminders" switch (checkbox with label, ≥44px target), reading the user's own
  `profiles.notify_email`. It calls the new RPC `set_notify_email(p_on boolean)`, which needs only a signed-in
  user (`private.require_user`), upserts the caller's own profile row and writes an audit row. Copy: "Email me
  before bidding closes and when it's time to pick for the next game."
- **Glossary / rules page:** one line on the Rules page under "Questions": "You'll get an email 24 hours and 2 hours before
  bidding closes, and when it's your turn to pick for the next game. Turn them off on the Me page."

## 8. Testing

- **DB tests, new file `tests/db/notify.test.ts`, on PGlite:**
  - bid windows: 25 h queues nothing, 23 h → `bid_24h`, 1 h → `bid_2h` only, after close / after
    `run_auction` → nothing
  - running twice queues no duplicates
  - moving the close requeues
  - opt-out and missing profile
  - a pick notice for the paired managers without a pick; none for a bye or a manager who already picked
  - `reset_game` + finish again → new notices
  - claim: lease, 3-try cap, 30-minute expiry, stale bid ref dropped, `skip locked` (two claims return
    disjoint rows)
  - `mark_outbox`
  - `set_notify_email` gates (anon refused, user sets only their own)
- **Existing gate tests:** the pg_proc RPC gate test must include `set_notify_email`. `claim_outbox` /
  `mark_outbox` are private and must not be executable by `authenticated`.
- **Use fixed fixture dates**, not `now()`, for stage dates (calendar-proof). Window tests set `bid_close_at`
  relative to `now()` on purpose.
- **App test:** the Me page switch calls the RPC with the toggled value.
- **The Edge Function has no automated test** (no Deno in CI). It is checked by hand at go-live (§9): queue a
  row to yourself, invoke the function, receive the mail.

## 9. Go-live (user-side, in this order)

1. **SQL Editor:** paste `0016_notify.sql`. It's additive: the old site ignores the new column, table and
   trigger. Pick notices start queuing right away but sit unsent until step 4, and expire after 30 minutes.
2. **Database → Extensions:** enable `pg_cron` and `pg_net`.
3. **Edge Functions → Deploy a new function → `notify`:**
   - Paste `supabase/functions/notify/index.ts` and turn "Verify JWT" off.
   - Secrets: `GMAIL_USER`, `GMAIL_APP_PASSWORD` (the existing app password), `CRON_SECRET` (any long random
     string).
4. **SQL Editor:** paste the `cron.schedule('notify', '* * * * *', …net.http_post…)` snippet from
   `docs/setup-supabase.md`, with your `CRON_SECRET` in it.
5. **Smoke test:** run the doc's one-line `insert into private.outbox …` to yourself. Within a minute the mail
   arrives and `sent_at` is set.
6. Merge + push (Me switch + Rules line), tag `m10-notify`, tick board t200 t201.

**Rollback:** `select cron.unschedule('notify');` stops all mail. The rest is inert without it.

## 10. Coordination with other branches

- **Migration 0014** (admin-powers) is live (tag `m10-admin`, pushed). **0015 is reserved for board t125**
  (refund auction spending when a tournament is deleted; other session, small, likely ships first), so this
  branch uses `0016`. If t125 is dropped or ships later, keep 0016 anyway: gaps in the numbering are harmless.
- **No SQL this branch touches is redefined by 0014 or t125.** The trigger approach avoids `finish_game` /
  `open_tournament`, and t125 only changes `delete_stage`. Before merging, rebase on `main` and re-run the DB
  tests with 0015 present.
- **App overlap is MePage.tsx, RulesPage.tsx and docs/setup-supabase.md.** Small additions; rebase on `main`
  before merging if M9 has touched them.
- **Board ids for M10 start at t200**, so they never collide with M9 / admin-powers ids (t124+).

## 11. Out of scope (add as M10 tasks if wanted)

SMS, phone push, a team-chat bot, per-kind preferences, one-click unsubscribe tokens (team-internal, far below
Gmail's bulk-sender threshold), HTML email, and notifying staff (keepers) about games.

## 12. Amendments from the verified build (2026-10-05, draft branch `m10-notify-verified-draft`)

1. **Bid subject says "closes within 24 hours" / "within 2 hours"**, not "in": a close set 10 hours out still sends
   the 24 h reminder at once, and "within" stays true. The body gives the exact time.
2. **The claim also drops a pick notice if the manager has picked since it was queued** (they may pick in the
   minute before the sender runs).
3. **Outbox kind `test`** for the go-live smoke test (§9 step 5): claimable with no bid/game checks.
4. **`set_notify_email` updates, it doesn't upsert:** a profile row needs a display name, and every signed-in user
   has one (the name screen comes first). No profile → `NOT_FOUND`; null → `INVALID_INPUT`.
5. **The Emails switch shows for every signed-in user**, including managers not linked to a player (the Me page
   used to show only "not linked yet" for them). The avatar menu's Me line becomes "Emails, attendance, injuries".
6. **`skip locked` isn't testable on PGlite** (one connection). The test pins the limit instead: two claims never
   hand out the same row.
7. **The pick email's fallback line matches the Rules page:** "or we'll start your most rested healthy player for
   you."
