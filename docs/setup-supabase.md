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
3. Coaches: have each sign in and set a name, then **Admin → Stat keepers → Make keeper**. Don't make coaches admins.
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
   balance.

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
