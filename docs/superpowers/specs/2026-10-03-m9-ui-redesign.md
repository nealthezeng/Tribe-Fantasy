# M9: UI/UX redesign (decision record)

Status: t85–t117 live (tag `m9-ui`); t118–t119 live (tag `m10-admin`); wrap-up below on branch `m9-wrapup`.
Board phase p13.
Written after the fact (2026-10-03): M9 has no fixed scope, so it ran request by request with the user instead of a
spec and plan up front. This file records what was decided, what was rejected, and what is still open, so the
branch can be reviewed against it. How the result looks is in [DESIGN.md](../../../DESIGN.md).

## How M9 runs

- No fixed scope. The user sends inspiration sites and asks; every distinct change gets its own board task the
  moment it's asked for (user rule), then `done` when built.
- Design work uses the impeccable skill (project context, craft floor, detector) and the ponytail skill.
- Mockups after every stage (user rule for the distill → clarify → polish passes): artifacts built from the app's
  real `tokens.css` + `styles.css`, not hand-drawn.
- Tally board is never animated and its tiles stay flat; nothing visual ships to it on tournament days.

## Decisions (all the user's unless marked)

| Board | Decision | Commit |
|---|---|---|
| t85 | Every design value lives in `src/app/tokens.css`; `tokens.test.ts` fails if `styles.css` gains a colour, font, radius or duration literal | a03f176 |
| t86 | Admin athlete rows: name, account picker, three equal buttons on phones; one line from 640px | a03f176 |
| t101 | Fonts: **Big Shoulders Display** 800 caps for page titles, brand, hero, big numbers; **Archivo** for the rest. Chosen from 6 pairings | a9a8997 |
| t102 | Gliding gold tab underline and admin pill (`useInk`), button press/lift | a9a8997 |
| t103 | League tab **matchup first**: "TEAM vs OPP" headline, facts strip, scoreboard of both picks, number tiles, then auction and tournament card (user liked the font page's mock) | 9f524cd |
| t104 | Auction bid rows in fixed columns so an Injured pill or Save+✕ never shifts the boxes | f20563e |
| t105–t107 | Green "Your pick" with a pop; frosted-glass panes | 1ed0da7 |
| t108–t109 | No button outlines; scoreboard labels level (subgrid) | 02a50c8 |
| t110 | **Always dark**, no light theme. The scoreboard's language (smoked glass, gold corner glow, lit edge, deep shadow) on every box. Chosen over "dark boxes on a light page" and "match each theme" | 2c107dc |
| t111 | Buttons **flat and crisp** (lift + glow on hover, squeeze on press). Chosen over keycap, push key, smoked glow, metal gold (cssbuttons.io inspiration) | b230cfc |
| t112 | Button lettering **Archivo narrow caps** (700, 78% width, 0.06em). Chosen over Archivo, Big Shoulders Text, Barlow SC, Saira SC, Oswald | ba0224e |
| t113 | Page sweep fixes: info boxes as blue-glow glass; settings textarea back to monospace (pre-M9 bug) | 75bd678 |
| t114 | Distill: tiles = Place / Record / Points; credits shown once; auction named once; empty Games hidden; admin explainer → 4 steps; rare forms folded. **Me > Attendance kept** (user) | 5a54b9b |
| t115 | Clarify: players see "game", not "session"; titles "Game 3 · Fall Beta" (`gameTitles`); errors and labels rewritten; DESIGN.md glossary | afeed34 |
| t116 | Polish (Claude's call, shown after): phone boxes float as rounded panes (square bands retired); disabled buttons quiet grey instead of faded gold | 79bae23 |
| t118 | **Light mode toggle** (user, reverses t110's no-toggle): follows the phone until Light mode / Dark mode is picked in the avatar menu (saved per device). Dark stays the base; light = the pre-t110 white glass, top bar / hero / scoreboard stay black. `data-theme` set before first paint by an inline script | (this branch) |

## Inspiration notes

- **awwwards.com**: taken: condensed display headline, "N of M" numbers, a facts strip under the headline (never an
  eyebrow above it), "athlete by manager" lines, arrow text links, bottom tab bar, cards with captions below, team
  photo hero; motion: live pulse ring, score ticker, card lift, menu slide-in, load fade, traced border. Skipped:
  weight-300 body text, borderless grey inputs (contrast), heavy imagery/video, eyebrow labels.
- **cssbuttons.io**: four styles built and compared on the real theme; flat and crisp chosen.

## Invariants (keep them)

- Colours, fonts, sizes, radii, shadows and durations only in `tokens.css` (guard test).
- Tally board: no transitions, no press/lift, flat tiles, plain cards, own lettering.
- Every tap target ≥ 44px; motion only without `prefers-reduced-motion`; colour never the only signal.
- One loud thing per screen in the display face; gold means act.

## Wrap-up (2026-10-05, branch `m9-wrapup` off main 2b2d690): closes M9

The user asked to finish the backlog, **front end only**, so M9 can run in parallel with M10 (notifications,
worktree `Tribe-Fantasy-m10`) without clashing.

**Triage (user):** build t90, t92, t93, t97, t98, t99. **Dropped** t96 live score ticker (game scores are hidden
until verified and taps are staff-only, so a front-end ticker has no live scores; the League headline's pulsing
Live marker covers "a game is on") and t100 traced border (the task said pick one of t95/t100; t95 pulse is live).
**Parked** t94 team photo (blocked until there's a photo everyone in it OKs; a one-file change later). The
attendance-toggle sliding thumb is left out: it lives on `MePage.tsx`, which M10 edits.

**No-clash rule.** This branch never touches SQL/migrations, `supabase/`, `src/app/lib/rpc.ts`,
`src/app/lib/errors.ts`, `MePage.tsx`, `RulesPage.tsx` or `docs/setup-supabase.md` (M10's files). New CSS goes in
`tokens.css` (values) and `styles.css` (rules) keeping the phone `@media` last. If M10 also adds CSS, the merge
conflict is at most a few appended lines.

### t92 Phone bottom tab bar
- Same `nav.tabs` markup, moved by CSS: below the phone breakpoint (where the tabs are a second row today) it is a
  fixed bottom dock: frosted glass like other panes, `padding-bottom: env(safe-area-inset-bottom)`, targets
  `--tap-lg` (48px), the gold `.ink` marker on its **top** edge. The top bar keeps brand + avatar only.
- `.shell` gets bottom padding = dock height + safe area so the last card isn't covered.
- The dock is **hidden on the tally board** (`/stats/:id`, SessionPage): `Layout.tsx` adds a class when the route
  matches; the brand link and the board's own controls get keepers out. Tally markup and CSS are not touched.
- Desktop unchanged. Signed out: no tabs, no dock.

### t93 Game cards, t97 card lift, t90 by-line (all in `TournamentCard.tsx`)
- The Tournament card's **Games** list becomes a grid of game cards: 1 column on phones, 2 from the desktop
  breakpoint. Each card is still a `<details>`: the summary is a **mini scoreboard** of the viewer's matchup on top
  (`Test Zeal 18.5 – 12 Money`; before scores: team names with "Playing" / "Waiting on stats"; "Bye"; "Not playing"
  when the team isn't in that game) and the **caption below** it: `Game 2 · vs Duke · Fall Beta`, status pill, and
  the viewer's `W +3.5`. Opening shows every matchup as today; an open card spans the full grid width.
- t97: on `(hover: hover)` devices only, a game card lifts `translateY(-4px) scale(1.02)` with a softer shadow over
  `--dur`; none with reduced motion. Games only (no lift on other cards).
- t90: inside an open game, each side reads `Christopher Mao by (T) Test Zeal` (round initial avatar like the
  account button's, team name); forfeit reads `Forfeit by (T) Test Zeal`. Header scoreboard and auction unchanged
  (auction "Every team" already groups rosters by team).

### t98 Menus slide in, t99 loading skeletons
- t98: the account menu popover drops 8px and fades in (~200ms ease-out) via `transition` +
  `@starting-style` on `:popover-open` (no JS; browsers without `@starting-style` just show it). Opening a
  `<details>` fades/drops its content in (keyframe on `details[open] > :not(summary)`); closing is instant.
- t99: a `Loading` component (`src/app/components/Loading.tsx`) renders a resting skeleton (a card-shaped block
  with a title bar and 3 lines) plus `<span class="sr-only">Loading…</span>` inside `role="status"`. It replaces the
  bare `<p className="muted" role="status">Loading…</p>` lines **except** in `MePage.tsx` (M10) and the tally pages
  (`TallyPage.tsx`, `SessionPage.tsx`: nothing visual ships to tally before tournaments). TournamentCard's
  "Loading games…" uses it too. Loaded content fades in (~0.3s) where a skeleton stood. Reduced motion: static
  skeleton, no shimmer, no fade.

### Tests and checks
- App tests: dock hidden on `/stats/:id` and shown on `/`; game card summary/caption for final / live / bye /
  not-playing; by-line text; `Loading` has `role="status"` + "Loading…" text (existing tests that wait for
  "Loading…" keep working).
- `tokens.test.ts` guards pass (new values are tokens; motion rules keep the tally `:not()` list).
- Sweep every route at 375px in dark and light (dock never covers content or the sticky bid header; tally board
  has no dock); desktop check of card lift.
- Final opus review of `main..m9-wrapup` before merge. Ship **before Oct 16** (never Oct 17–18 / Nov 7–8). Tag
  `m9-wrapup`; rollback = tag `m10-admin`. No migration.

## Risks and checks before / after merge

- **Dark tally in sunlight**: keepers use it outdoors. Light mode (t118) is the answer now: a keeper's phone set to
  light, or the avatar-menu toggle. Still try the light tally on a phone in daylight before Nov 7.
- **Unseen with real data**: tally board with players, Stats with games, auction results after a run, the League
  scoreboard mid-tournament. Look on a phone at the Oct 17–18 dry run and the first game.
- **Blur on low-end phones**: only cards, tiles, scoreboard, menu, bid header and subnav blur; scroll-test an old phone.
- **Merge timing**: before Oct 16 or after the Oct 17–18 dry run, never during it.
- No migration: front-end only. Rollback point is tag `m9-t4`.

## Final review (2026-10-03, opus, adfb252..7cae0ab): "With fixes" → fixed

- **Critical, fixed:** the button lift/glow/squeeze rules out-ranked the tally opt-out (specificity 0,4,0 vs 0,3,1),
  so stat tiles rose and glowed on hover and squeezed under the thumb. The tally board (`.tally-buttons`, `.tally-head`,
  `.tally-bar`) is now inside each motion rule's own `:not()` list; `tokens.test.ts` fails if a lift/squeeze rule
  forgets it. Measured with a real hover: tally buttons stay at `transform: none`, no glow, no transition. The tally
  bar also keeps its own lettering and disabled look. Admin chips and segmented buttons no longer squeeze either.
- **Important, fixed:** the League header showed an injured or benched pick in green as if set; it now drops the
  green and says "Your pick is injured" / "Your pick is on the bench". Byes say "Bye" in every state.
- **Important, fixed:** header tests for live (both picks revealed), final between tournaments (result + greyed
  loser; final needs the stat lock), bye, and injured pick.
- **Minor, fixed:** Edit on another tournament reopens the folded form (keyed details); OWNS_ATHLETE and
  ATHLETE_IN_USE wording; Tally list uses `gameTitles()`; "· N available" on the bid list; long team names wrap;
  letter-spacing tokens + guard; page glow moved to a fixed `body::before` (a fixed body background repaints every
  scroll frame on phones); docs "one font" line; CreditForm indentation.
- **Minor, left:** header vs PickGame wording for a rosterless or joined-after-pairing team; "T1 of 6" before any game;
  `gameTitles` sends every session id in one `.in()` (fine at this volume).
