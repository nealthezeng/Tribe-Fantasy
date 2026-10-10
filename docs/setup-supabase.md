# Supabase setup (tribe-dev now, tribe-prod later)

1. Create a free project at supabase.com named `tribe-dev`. Keep the database password in your own password manager. Never put it in the repo or in chat.
2. **Apply migrations:** open SQL Editor, then paste and run each file in `supabase/migrations/` in numeric order.
3. **Authentication → Sign In / Providers:**
   - Email enabled; **Anonymous sign-ins OFF**.
   - Email OTP length **6**; the login page tells people to type a 6-digit code.
4. **Authentication → URL Configuration:**
   - Site URL: `https://nealthezeng.github.io/Tribe-Fantasy/`
   - Redirect URLs: `https://nealthezeng.github.io/Tribe-Fantasy/` and `http://localhost:5173/Tribe-Fantasy/`
5. **Authentication → Email Templates:** add `Or enter this code: {{ .Token }}` to **both** templates:
   - **Magic Link**
   - **Confirm signup**, because a teammate's very first sign-in uses this one.
6. **Authentication → SMTP:** Supabase's built-in email only reaches your own project team and is heavily rate-limited, so set up a custom sender. Put its SMTP credentials in the Supabase dashboard only. The easiest option is a Gmail app password (about 500/day); Brevo's free tier (300/day) also works.
7. **Project Settings → API:** copy the Project URL and the `anon` `public` key. Both are public by design. Set them as GitHub repo **variables**:
   ```
   gh variable set VITE_SUPABASE_URL --body "<url>"
   gh variable set VITE_SUPABASE_ANON_KEY --body "<anon key>"
   ```
   Then re-run the Deploy workflow.
8. **First admin:** sign in once on the site, then run this in SQL Editor:
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin' from auth.users where email = '<your email>';
   ```
9. **Local dev:** create `.env.local` (it's gitignored) with the same two `VITE_` values, then run `npm run dev`.

**Troubleshooting:** if a sign-in link opens `localhost` ("can't connect to server"), the Site URL or Redirect URL in step 4 doesn't exactly match `https://nealthezeng.github.io/Tribe-Fantasy/`. Fix it, then request a new link.

## M3 stats (after 0001–0003)

1. SQL Editor: paste and run `supabase/migrations/0004_stats.sql`, then `0005_stats_rpcs.sql`.
2. Seasons created before M3 still store the old 8 stats. In **Admin → season → Settings**, set
   `"stat_weights": {"goal": 3, "assist": 3, "block": 3, "callahan": 8, "turnover": -2}`,
   `"normalize_mode": "none"` and add `"tap_merge_seconds": 10`, then save.
   Change `stat_weights` before the first tap of a season; removing a stat that already has taps makes those
   sessions impossible to verify.
3. Coaches: have each sign in once (the app asks for their name; no league needed), then **Admin → Stat keepers → Make keeper**. Don't make coaches admins.
4. Players: **Admin → Athletes → linked account** for each player who wants to mark attendance/injuries.

## M4 stages and wallet (after 0001–0005)

1. SQL Editor: paste and run `supabase/migrations/0006_stages_wallet.sql`. It also removes the retired
   `min_credits_to_play`, `free_entry` and `extra_credit_cap` keys from saved season settings.
2. In **Admin → season → Settings**, check `roster_size` (4 for 6 × 4 leagues, 3 for 8 × 3) and `max_members` (6 or 8).
   Leave `donations_enabled` false until the legal sign-off.
3. **Admin → season → Stages**: add the fall beta stage (Oct 18 – Nov 8, ends at the Nov 7–8 tournament). After
   everyone has joined, press **Grant allowance**. Press it again for anyone who joins later.

## M5 stage auction (after 0001–0006)

1. Before merging this branch to `main` (pushing to `main` auto-deploys, and the new Tally and Home screens read the
   new tables): SQL Editor: paste and run `supabase/migrations/0007_auction.sql`. It only adds tables and columns and
   tightens three stats RPCs, so it's safe to run while the old site is still deployed.
2. Before opening: **Grant allowance** for the stage, and check **Athletes**: every league needs members × `roster_size`
   healthy opted-in players (a confirmed, uncleared injury doesn't count).
3. **Admin → Stages**: pick **Bids close** (your local time) and press **Open auction**. You can move the close time
   until bids close. Nobody, admins included, sees anyone else's bids until then.
4. After close, press **Run auction** once. It reports how many players went by bid, by random fill, and how many
   spots stayed empty.
5. Once rosters exist, keepers and admins can't tally, verify, reopen, correct or mark attendance for players on their
   own fantasy roster. Another keeper has to, and a correction to an admin's own player needs a second admin.

## M6 weekly play (after 0001–0007)

1. SQL Editor: paste and run `supabase/migrations/0008_weekly.sql` **before** the new site deploys. It adds weeks and
   picks, lets the league see cleared injuries, and cleans retired settings. The old site's **Grant allowance**
   button stops working until the new site is live (it now sends the standings). Between pasting 0008 and the
   deploy, don't save **Settings** or create a season on the old site — an old admin tab writes the retired keys
   back and the new site then rejects them.
2. After the deploy, hard-reload any open admin or keeper tabs — do this before touching **Settings**.
3–4. Retired by T4 (0013): weekly picks and weeks are gone.
5. Standings and scores are computed in each browser from locked stats, so a correction or reopen shows up on the
   next page load. **Grant allowance** now pays by the current standings and warns if an earlier week isn't final.

## M8 hardening (after 0001–0008)

1. SQL Editor: paste and run `supabase/migrations/0009_hardening.sql`. It only replaces four functions, so it is
   safe before or after the deploy:
   - a week's pick lock can't be moved once it has passed, or to after the week ends;
   - a keeper still counts as an athlete's owner for a week after that stage ends (its closing tournament);
   - a keeper can't confirm their own injury.
2. **Admin → Settings** on the live season: if `upset_k` shows 2, set it to 0.5 before any week is scored. A season
   stores every setting when it's saved, so the new default only reaches seasons that don't store `upset_k`.
3. **Admin → Backup**: download a backup every week and keep it somewhere private. The ledger and standings CSVs
   are for the treasurer.
4. The rules page is public at `#/rules` (linked from the landing page and the account menu). Its numbers are the
   standard settings in `src/core/settings.ts`, not a season's own settings.

## M8.5 quality-of-life (after 0001–0009)

1. Before pasting, check no open stage already has a manager whose bids total more than their balance (the new
   `place_bid` would refuse that manager's next bid, but existing bids are untouched either way):
   ```sql
   select b.membership_id, sum(b.amount) as bid_total,
          (select coalesce(sum(amount), 0) from public.credit_ledger where membership_id = b.membership_id) as balance
   from public.bids b join public.stages s on s.id = b.stage_id
   where s.bid_close_at > now() and s.auction_run_at is null
   group by b.membership_id
   having sum(b.amount) > (select coalesce(sum(amount), 0) from public.credit_ledger where membership_id = b.membership_id);
   ```
2. SQL Editor: paste and run `supabase/migrations/0010_qol.sql` before the deploy. It's additive, so the old site
   keeps working — the only behaviour change it sees is the stricter `place_bid`: bids may not total more than the
   balance. It also adds `rename_athlete`, `delete_athlete` (only athletes with no history) and `delete_session`
   (only an empty, unverified session; its creator or an admin).

3. SQL Editor: paste and run `supabase/migrations/0011_force_delete.sql` before the deploy: admin force-delete of an
   athlete or session (the old one-argument calls still work).

## Tournament mode (after 0001–0011)

1. SQL Editor: paste and run `supabase/migrations/0012_tournament.sql` before deploying the tournament build: games,
   pairings, game picks and bench swaps. It's additive; the old site keeps working.

## T4 retire weekly (after 0001–0012)

1. Optional: **Admin → Backup** → download a Backup JSON first to keep the old weekly rows.
2. SQL Editor: paste and run `supabase/migrations/0013_retire_weekly.sql` **before** deploying the T4 build. It drops
   weeks, picks and their RPCs, and strips `pick_lock_day`, `pick_lock_time` and `usage_reset` from season settings.
3. Between the paste and the deploy, nobody saves season **Settings** on the old site — an old admin tab writes
   those keys back and the new build rejects them.
4. After the deploy, hard-reload every open admin and keeper tab (GitHub Pages can serve a cached `index.html` for a
   few minutes).
5. If the site errors on settings after the deploy, run in the SQL Editor:
   ```sql
   update public.seasons set settings = settings - array['pick_lock_day','pick_lock_time','usage_reset'];
   ```

## Admin powers (after 0001–0013)

1. SQL Editor: paste and run `supabase/migrations/0014_admin_powers.sql` **before** deploying the build. It is
   additive: admins skip the owner and tallied-it-yourself checks, `delete_stage`, `reset_game` and
   `set_game_opponent` appear, games get an `opponent` column, and deleting a tournament keeps its credit rows.
   The old site keeps working on it.
2. Deploy (merge + push). Hard-reload open admin and keeper tabs.
3. Before deleting a tournament for real, **Admin → Backup** → download a Backup JSON: deletes can't be undone.

## Refund on tournament delete (after 0001–0014)

1. SQL Editor: paste and run `supabase/migrations/0015_refund_on_delete.sql`. It only replaces `delete_stage`, so it
   is safe any time: deleting a tournament now gives each team back what it paid for the players still on its
   roster (one `Refund: <tournament> deleted` row per team). Allowances stay.
2. Deploy (merge + push): the delete confirmation says so.

## M10 email notifications (after 0001–0014; 0015 is independent)

Bid reminders (24 h and 2 h before bidding closes) and next-game pick notices, sent from the Gmail account already
used for sign-in mail. SQL queues them; the Edge Function `notify` sends them; `pg_cron` runs it every minute.

1. SQL Editor: paste and run `supabase/migrations/0016_notify.sql`. It's additive and safe before the deploy: pick
   notices start queuing at once, but nothing is sent until step 4, and anything unsent for 30 minutes expires.
2. **Database → Extensions**: enable `pg_cron` and `pg_net`.
3. **Edge Functions → Deploy a new function → Via editor**, name it `notify`:
   - paste `supabase/functions/notify/index.ts`, and turn **Verify JWT** OFF (the function checks its own secret);
   - **Edge Functions → Secrets**: add `GMAIL_USER` (the Gmail address), `GMAIL_APP_PASSWORD` (the same app
     password as Auth → SMTP), and `CRON_SECRET` (any long random string; make one with
     `select md5(random()::text) || md5(random()::text);`).
4. SQL Editor, with your `CRON_SECRET` pasted in:
   ```sql
   select cron.schedule('notify', '* * * * *', $$
     select net.http_post(
       url := 'https://effyjptuoztyduydwcwh.supabase.co/functions/v1/notify',
       headers := '{"x-cron-secret": "PASTE-CRON-SECRET-HERE"}'::jsonb,
       timeout_milliseconds := 60000
     )
   $$);
   ```
   Also schedule a daily cleanup of cron's run history (it keeps a row per run, secret included):
   ```sql
   select cron.schedule('notify-cleanup', '0 4 * * *', $$
     delete from cron.job_run_details where end_time < now() - interval '7 days'
   $$);
   ```
5. Smoke test, in the SQL Editor (sends one email to every membership you own):
   ```sql
   insert into private.outbox (membership_id, kind, ref, subject, body)
   select m.id, 'test', now()::text, 'Tribe Fantasy test email', 'If you can read this, notifications work.'
   from public.memberships m join auth.users u on u.id = m.user_id where u.email = 'YOUR-EMAIL-HERE';
   ```
   If it says `INSERT 0 0`, that account has no team: use an email that is in a league.
   Within a minute the email arrives. Check: `select kind, tries, sent_at, error from private.outbox order by id desc limit 5;`
   (`error` says what went wrong; the function's **Logs** tab shows each run's `{queued, sent, failed}`).
6. Deploy (merge + push): the Me page gets the Emails switch, the Rules page a line about emails.

Stop all email at any time: `select cron.unschedule('notify');`. If the pick trigger ever gets in the way of a tournament (it runs inside Finish / Open tournament), remove it with `drop trigger game_pairings_pick_notice on public.game_pairings;`. Gmail allows about 500 emails a day.

## Venmo donations (0021, Edge Function `venmo-intake`)

Donors Venmo the treasurer with their team's 4-letter code in the note. Venmo's "paid you" emails are forwarded to a
Gmail that holds nothing else; `venmo-intake` reads only that mailbox every 10 minutes and SQL credits the team.
Your personal inbox's password never goes into Supabase.

1. SQL Editor: paste and run `supabase/migrations/0021_venmo.sql` BEFORE pushing the app (the new app reads
   `memberships.donation_code`). If asked, choose **Run without RLS** (`private.venmo_receipts` isn't API-exposed).
   Check: `select count(*) from public.memberships where donation_code is null;` → 0.
2. Make a new Gmail used only for this (e.g. `tribefantasy.venmo@gmail.com`). Turn on 2-Step Verification, then
   create an **app password** (Google Account → Security → App passwords).
3. In your **personal** Gmail: Settings → Forwarding and POP/IMAP → **Add a forwarding address** → the new address;
   open the confirmation email in the new account and click the link. Leave "Disable forwarding" selected there (the
   filter below forwards only Venmo receipts).
4. Personal Gmail → Create a filter: From `venmo@venmo.com`, Has the words `"paid you"` → **Forward it to** the new
   address (optionally also apply a label).
5. **Edge Functions → Deploy a new function → Via editor**, name it `venmo-intake`: paste
   `supabase/functions/venmo-intake/index.ts`, turn **Verify JWT** OFF. **Secrets**: add `VENMO_GMAIL_USER` (the new
   address) and `VENMO_GMAIL_APP_PASSWORD` (step 2). `CRON_SECRET` is already there from `notify`.
6. Smoke test (before scheduling): have someone Venmo you $1 with a team's code in the note (Home shows each team's
   code). Wait for it to arrive in the new inbox, then in SQL Editor:
   ```sql
   select net.http_post(
     url := 'https://effyjptuoztyduydwcwh.supabase.co/functions/v1/venmo-intake',
     headers := '{"x-cron-secret": "PASTE-CRON-SECRET-HERE"}'::jsonb,
     timeout_milliseconds := 60000);
   ```
   then `select status, payer, dollars, code from private.venmo_receipts order by id desc limit 5;` → `credited`
   (or `disabled` if donations are still off — fine for the test). **Edge Functions → venmo-intake → Logs** show
   the counts. `unsigned` means the forwarded mail lost Venmo's signature: stop and tell Claude.
   If the logs show a connection error to `imap.gmail.com:993`, Supabase blocks that port: stop and tell Claude.
7. Schedule it:
   ```sql
   select cron.schedule('venmo-intake', '*/10 * * * *', $$
     select net.http_post(
       url := 'https://effyjptuoztyduydwcwh.supabase.co/functions/v1/venmo-intake',
       headers := '{"x-cron-secret": "PASTE-CRON-SECRET-HERE"}'::jsonb,
       timeout_milliseconds := 60000
     )
   $$);
   ```
8. Admin → Settings: set `"venmo_handle": "<your Venmo username, no @>"` and `"donations_enabled": true`.

Stop all intake: `select cron.unschedule('venmo-intake');`. Receipts that didn't become credits are listed in
Admin → Wallets; fix them with **Record a donation**. A refund = **Adjust credits** with a negative number.

## "That was the last game" (t202, after 0016)

1. SQL Editor: paste and run `supabase/migrations/0017_last_game.sql` BEFORE the deploy. It replaces `finish_game`
   (new optional `p_last`; the old site's calls still work), adds `add_next_game`, and drops the "ignore this email"
   sentence from pick emails.
2. Deploy (merge + push): the Finish panel gets "That was the last game"; after it the tally list says the tournament
   is over, with "Add game N+1" to undo a wrong tap.

## Rename or delete a season (t213, after 0017)

1. SQL Editor: paste and run `supabase/migrations/0018_season_admin.sql`. It only adds `rename_season` and
   `delete_season`, so it's safe any time before the deploy.
2. Deploy (merge + push): Admin → Seasons gets "Rename or delete <season>" for the season being managed. Delete
   unlocks once the season's name is typed, removes everything in the season, and is refused for a season with
   donation records. Download a backup first. Deleting the newest season moves everyone to the next newest.

## Open leagues (t215, after 0018)

1. SQL Editor: paste and run `supabase/migrations/0019_open_leagues.sql`. It adds `leagues.created_by`, a private
   password table and six RPCs (`list_leagues`, `create_my_league`, `join_open_league`, `rename_league`,
   `set_league_password`, `delete_league`); the old invite-code functions stay. Paste it BEFORE the deploy: the new
   build calls `list_leagues` on Home.
2. Deploy (merge + push): Home offers Join a league (`/leagues`, searchable, "N of M teams") and Create a league
   (`/leagues/new`, public or password). One created league per person per season (admins exempt). The creator
   manages it from Home; Admin → Leagues lists every league with Delete (refused when it has donation records).
3. Right after the deploy: leagues made before 0019 (e.g. League A) have no creator and no password, so ANYONE
   signed in can join them until they're full. If that's not wanted, an admin sets a password in Admin → Leagues
   (works for any league, member or not) or from Home → Manage <league>.

## Leave a league (t217, after 0019)

1. SQL Editor: paste and run `supabase/migrations/0020_leave_league.sql`. It only adds `leave_league`, so it's safe
   any time before the deploy. If the editor offers "Run and enable RLS", choose **Run without RLS** (no new table).
2. Deploy (merge + push): each team on Home gets "Leave <league>" (with a confirm). Refused with a clear message when
   the team has a donation, any bid (open, or a player won by bidding), or a game pairing (leaving would erase the
   opponent's result). Leaving removes the team, its allowance and its random-fill players. The last team to leave
   deletes the league, whoever created it, including older admin-made leagues (user ruling 2026-10-06). When the
   creator leaves and others stay, the league becomes admin-managed and the creator's one-league slot frees up.
   Home hides Leave once the team has a donation. A leave at the exact moment an auction runs can deadlock; Postgres
   cancels one of the two and a retry works (see the comments in 0020).
