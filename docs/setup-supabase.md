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
