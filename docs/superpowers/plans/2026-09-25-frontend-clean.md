# Front-end cleanup plan (before M5)

Branch `frontend-clean` off `main` (tag `m4`). No database changes, no new dependencies, no behavior changes.
Sources: `PRODUCT.md`, `docs/frontend-principles.md`, the graphify code graph, and a read of every file in `src/app/`.

## Direction

This is a refinement, not a redesign. Keep what's there: pine-green accent, system font, warm off-white paper,
cards, the 720px column. The goal is a calm, readable phone app for use at the field. That means fewer boxes,
a real type scale, big numbers where they matter (balance, tally counts), and every state spelled out in words.
Most screens are task screens ("Operate" mode). The signed-out landing page is the only one that has to sell
anything, and it keeps its current copy.

## What's wrong today (evidence)

1. **Dark-mode contrast fails.** White text on the dark accent `#3ba57d` is about 3.1:1, and the error red
   `#b3261e` on `#151515` is about 2.8:1. Both need 4.5:1. Every primary button is affected.
2. **Tap targets under 44px.** `.linklike` sets `min-height: 0`, and it's used for tally attendance, *Confirm
   injury*, *Opt out*, *Make keeper*, *Dismiss*, *Use a different email* and *Sign out*.
3. **No type scale.** The browser-default `h1` is 32px bold, which is too big on a phone. Headings, labels and
   notes don't follow any system, and numbers aren't tabular.
4. **Nav overflows at 375px** for an admin who is also a keeper (brand plus six items on one row). There's no
   active-page indicator either.
5. **Nested cards.** Leagues has a card inside a card, and Wallets puts a form card inside a card. The admin page
   is a single wall of seven panels, ordered Seasons, Staff, Settings JSON, and so on, which isn't
   most-used-first as the principles ask.
6. **Success messages are unstyled.** `<p>{status}</p>` looks like body text. Errors aren't announced
   (`role="alert"`/`"status"` are missing), and there's no `:focus-visible` style.
7. **The tally board is a wall of solid green.** Every stat button is a filled accent button, so the counts,
   the negative turnover button and the sync state don't stand out. The sticky bar wraps unevenly.
8. **Raw data formats.** Dates show as ISO `2026-09-25`, the session kind is lowercase `practice`, and state is
   plain muted text.
9. **Small gaps.** Home crams team, league, balance and history into one list row. There's an inline
   `style={{opacity}}` in Athletes, and no `theme-color` or favicon (so every page load hits a 404).

## Tasks

### T1 · Foundation: `styles.css`, `Layout.tsx`, `index.html`
- Tokens: add a type scale (`--fs-sm` 14, `--fs-md` 16, `--fs-lg` 20, `--fs-xl` 26), a spacing scale
  (4, 8, 12, 16, 24, 32), `--ok`/`--warn` plus soft variants, and an `--accent-ink` that flips to dark ink in
  dark mode. Fix the dark `--error` and give `.badge` its own text colour.
- Base: body line-height 1.5, sized `h1`/`h2`/`h3` with tighter margins, `tabular-nums` on tables and numbers,
  a `:focus-visible` ring on everything interactive, `cursor: not-allowed` on disabled controls.
- Components: `.linklike` keeps a 44px hit area but still looks like a link. Add `.success` (with
  `role="status"`), `.pill` (session state, keeper, injured, opted out; always with a text label), `.stack`
  and `.section` for sub-groups inside a card instead of nested cards, and `.num-lg` for headline numbers.
- Layout: `NavLink` with `aria-current` and an underline on the active page. At 375px the nav drops to its own
  row under the brand, with no overflow.
- `index.html`: `theme-color` meta for light and dark, and an inline SVG favicon.

### T2 · Player pages: Home, Login, Join, Me, Stats, Session, NotConfigured
- Add a shared `formatDay('2026-09-25')`, which returns "Fri, Sep 25", plus a capitalised kind label, in
  `lib/stats.ts`. It gets one small test.
- **Home:** one card per team: the team name, then league and season in muted text, then the balance as a large
  number with "credits" after it. History goes in a "Credit history" disclosure. The empty state becomes a card
  with a *Join a league* button. The landing copy stays as it is.
- **Login and Join:** the code field gets a large monospace style and the invite code is shown in upper case.
  Secondary actions become proper 44px links.
- **Me:** Present/Absent becomes a segmented pair with `aria-pressed`, dates are formatted, and the injury card
  gets a clear status line.
- **Stats list:** each row shows the formatted date and kind, plus a state pill (Not verified / Verified /
  Locked) and a "Not counted" pill. *Download CSV* becomes a secondary button in the header row.
- **Session:** formatted title, a state pill, tabular stat table, a prominent *Verify these totals* button, and
  attendance as two short lists.

### T3 · Tally board (`TallyPage.tsx`)
- The sticky bar gets two tidy rows: *← Sessions* with the session title, then a sync pill (Saved ✓ / 3 unsaved /
  Offline · 3 unsaved) and *Undo last tap* as a bordered secondary button that's always in reach.
- Stat buttons become neutral surface buttons with a large count. Negative-weight stats (turnover) get a
  distinct border and a "−" in the label, so the difference isn't carried by colour alone. Press feedback uses
  `:active` only, with no animation.
- Attendance and *Confirm injury* become 44px chips, visually separated from the stat grid so they can't be
  mis-tapped.
- The session picker gets formatted dates, and unsaved taps show as a warn pill.

### T4 · Admin console (`pages/admin/*`)
- New order, most-used first: Season picker, Stages, Leagues and invites, Wallets, Athletes, Stat keepers, then
  Settings JSON in a closed `<details>`.
- Flatten the nested cards: leagues become sub-sections split by dividers, and credit forms become sub-sections.
- Athletes: the inline opacity becomes an "Opted out" pill with muted text. Keepers get a "Keeper" pill.
- Every status and result message uses `.success`/`.error` with live-region roles. Invite codes get monospace
  and a larger size.

### T5 · Verify and hand off
- `npm test`, `typecheck`, `lint` and `build` all green.
- Run the Impeccable detector once over the changed files.
- Screenshots at 375 and 1280, light and dark, from local dev. That needs `.env.local` (the public values in the
  repo variables) and **you signing in once in the preview browser** for the signed-in pages.
- A finish review by the `impeccable-finish-reviewer` subagent, then one fix batch.
- Docs: `DESIGN.md` (the token and component record, written by `impeccable-documenter`), linked from
  `CLAUDE.md` and `frontend-principles.md`. Fix the stale PRODUCT.md line ("tenure degradation resets on trade")
  and commit PRODUCT.md. Add "dark-mode contrast of accent and error" to the principles checklist.
- Merge to `main` and push (that deploys) only after you've seen the screenshots.

## Not doing (say if you want any of these)
- Team colours or a logo. Needs your input (see question 1).
- Confirm dialogs for *Grant allowance* and the credit forms. The principles ask for them, but they're a
  behavior change. It's one native `confirm()` each if you want it.
- Jump links on the admin page (hash routing makes anchors awkward). Reordering plus the collapsed settings
  covers most of it.
- New copy or claims on the landing page.

## Questions (defaults in brackets)
1. Keep the pine green, or use the team's colours? [keep green]
2. Execution: done inline by me in one coherent pass, with a subagent finish review [yes], or the full
   per-task subagent flow like M3 and M4?
