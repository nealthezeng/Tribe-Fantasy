# Tribe Fantasy design system

What the shipped UI looks like, recorded from `src/app/styles.css`, `src/app/components/Layout.tsx` and
`src/app/pages/`. How a page should behave (one job per screen, plain words, show state, the checklist) lives
in [docs/frontend-principles.md](docs/frontend-principles.md). Who it is for lives in [PRODUCT.md](PRODUCT.md).
**To change the look, edit `src/app/tokens.css`**: every colour, font, size, radius, shadow and
duration lives there. `src/app/styles.css` imports it and only reads the tokens. The favicon and `theme-color` in
`index.html` can't read CSS, so they repeat gold, baby blue and the bar colour by hand; so do the app manifest
(`public/manifest.webmanifest`: the bar and page colours) and the app icons' background. Reuse the classes in
`styles.css` before adding new ones. No UI libraries.

## Colour

**Dark first, light on request** (M9): dark is the base, the scoreboard's world of smoked glass, a faint gold and
blue glow, and white type. Light mode (t118) is white glass on a pale page; the top bar, hero and scoreboard stay
black in both. The site follows the phone's setting until someone picks Light mode / Dark mode in the avatar menu
(remembered on that device). An inline script in `index.html` sets `data-theme` on `<html>` before first paint;
`tokens.css` holds the dark values in `:root` and only the differences under `:root[data-theme='light']`. The
table below lists the dark values. The team's two colours are fixed by the user: gold and baby blue.

**Bright tally** (M15 t330): the tally board alone has a daylight theme, on by default. While the board is on screen
it sets `data-tally="bright"` on `<html>`; `tokens.css` applies light mode's values under that attribute too (the light
block's selector is `:root[data-theme='light'], :root[data-tally='bright']`) and then a short `:root[data-tally='bright']`
block with more contrast: a white page and panes, black text, `--muted` #39424c (about 10:1), dark stat-tile edges
(`--line-strong` #1c232b), and no glow, glass blur or pane shadow. The top bar stays black. Leaving the board removes
the attribute, so every other page keeps the app's own theme.

| Token | Value | Role |
|---|---|---|
| `--gold` | #f5b700 | Actions: primary buttons, current tab underline, text selection, the disc, the avatar |
| `--gold-deep` | #c99400 | The ring in the disc mark |
| `--gold-hover` / `--gold-press` | #ffc629 / #dba300 | Button hover and press |
| `--on-gold` | #111111 | Text on gold. Never white. |
| `--gold-text` | #f5b700 (light #8a6400, about 5:1 on white) | Gold as text: your rank in a ranked list, "Pick 2" on a game line, a rising since chip, the outlined Buy shares fold |
| `--check` | `--gold` (light and the bright board: #0b5d99) | Checkbox fill (gold is about 1.7:1 on a white pane), e.g. the tally bar's "Bright board" |
| `--blue` | #8cc8f2 | Info and selection, the disc centre |
| `--blue-soft` / `--blue-ink` | #16304a / #bfe1fa | `.notice` and `.pill.info` background and text |
| `--link`, `--focus` | #8cc8f2 | Links and the 3px focus ring |

Neutrals:

| Token | Value | Role |
|---|---|---|
| `--bg` | #080b0f | Page background, under `--bg-ambient` (gold glow top left, blue glow top right) |
| `--surface` | #121820 | Inputs; tally player cards |
| `--surface-2` | #1a2129 | Secondary buttons, tally buttons, neutral pill |
| `--fg` | #e8edf2 | Text |
| `--muted` | #9aa6b2 | Secondary text, labels, table headers, placeholders |
| `--line` | #232c36 | Dividers inside panes |
| `--line-strong` | #66737f | Input and segmented borders |
| `--bar` / `--bar-fg` / `--bar-muted` | #05070a / #fff / #9aa6b2 | Top bar |

Status, each with a soft background for pills:

| Token | Value | Used by |
|---|---|---|
| `--ok` / `--ok-soft` | #7fd69a / #16301f | `.success`, `.pill.ok`, a picked pick row (name and ring); `--ok-on-bar` for your set picks on the scoreboard |
| `--warn` / `--warn-soft` | #f4b566 / #3a2a13 | `.pill.warn`, `.notice.warn` (Admin's stuck-game warning) |
| `--error` / `--error-soft` | #ff8a80 / #3b1a18 | `.error`, `.pill.bad`, the Live dot and word, a falling since chip, `.danger-link` |

## Brand mark

`DiscMark` in `Layout.tsx`: a disc seen from above. Gold circle, darker gold ring (#c99400), baby blue centre.
The same drawing is the favicon in `index.html`; change both together. It sits at 24px beside "Tribe Fantasy"
in the black top bar. The signed-out hero shows the team's crest instead (below).

The installed app's icons (M15 t326) are the team crest (`src/app/assets/team-logo.png`) centred at 65% of the side
on a `#05070a` square (`--bar`): `public/icon-192.png`, `public/icon-512.png` (also the maskable icon: the whole crest,
banner tail included, sits inside the 80% safe circle; it was 66% until M15 P9, which let the tail touch the edge) and
`public/apple-touch-icon.png` (180px). They are drawn with PowerShell's System.Drawing (the command is in
`docs/superpowers/plans/2026-10-22-m15-p8.md`, Task 1, with 0.65 for the size); redraw them when the crest changes.

## Type

Two faces, both from Google Fonts in `index.html` (`display=swap`):

- **Big Shoulders Display** 800, uppercase (`--font-display`, `--fw-display`, `--display-case`, `--display-track`):
  the loud voice. Tall and tight like a scoreboard. Only for `h1` page titles, the brand, the signed-out hero and
  `.big` numbers; never below about 22px and never for running text. `h1 small` drops back to Archivo. Chosen by
  the user in M9 from six pairings (board t101).
- **Archivo** for everything else: a grotesque made for sports and news graphics, with even figures for stats
  (variable, weights 400–700, widths 75–100%, system-ui fallback).

Font tokens: `--font-sans` (Archivo stack), `--font-heading` (points at `--font-sans`) with `--heading-stretch`
92% so headings and the brand use a slightly condensed cut, and `--font-mono` only for `code`, the settings
textarea and `.code` (sign-in codes). Weights come from four tokens: `--fw-regular` 400 (body), `--fw-medium` 500,
`--fw-semi` 600 (buttons, labels, pills, row titles) and `--fw-bold` 700 (`h2`, `h3`).
Condensed headings take no negative letter-spacing; it closes the word gaps. To swap the font, change the link in
`index.html` and the font lines in `tokens.css`.

| Token | Size | Use |
|---|---|---|
| `--fs-xs` | 13px | Pills, table headers |
| `--fs-sm` | 14px | Labels, `small`, tables, subnav |
| `--fs-md` | 16px | Body, `h3` |
| `--fs-lg` | 20px | `h2` |
| `--fs-brand` | 24px | The brand in the top bar (display) |
| `--fs-xl` | 26px | Player names on the scoreboard, the Credits balance and team code, Standings rank and points |
| `--fs-num` | 40px | `.big` headline numbers (display, tabular) |
| `--fs-display` | 40px | `h1` page titles (display) |
| `--fs-hero` | 64px | The signed-out hero headline (display) |

Body line height 1.5, headings 1.2 and balanced. Numbers that line up use `.num` or tabular figures.
Smaller steps for single components are tokens too: `--fs-3xs` 11px (tally weights), `--fs-2xs` 12px (tally
labels), `--fs-lead` 18px (brand, hero text, sign-in codes, tally player names), `--fs-count` 24px (tally counts).
`src/app/tokens.test.ts` fails if `styles.css` gains a colour, font size, font family, radius or duration literal.

## Space and shape

Spacing: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32 (px). Layouts stack with grid `gap`, not margins.

Radii: `--radius` 14px for cards and the hero, `--radius-sm` 10px for buttons, inputs, list rows and notices,
`--radius-xs` 8px for account menu items, `--radius-pill` for pills and admin's group chips. Shadows belong to the pane
system (`--pane-shadow`, `--score-shadow`, see Depth) plus the gold hover glow `--shadow-lift`.

Touch: `--tap` 44px minimum, `--tap-lg` 48px tabs and menu items, `--tap-tally` 76px stat buttons. Motion:
`--dur` 150ms with `--ease`, and `--dur-flash` 400ms for the over-budget flash; `--dur-menu` 200ms for menus and
opened sections dropping in, `--dur-fade` 300ms for loaded content fading in, `--dur-rest` 1.6s for a loading
skeleton's slow breathing, `--dur-count` 600ms for a score counting up to its new value.

Frame: a full-width black top bar, then one column (`--shell` 720px, `--gutter` 16px side padding, 24px top). Rows
that open something are 56px tall (`.list li`, `.row-link`, `.game-line`, `.ranks li`).

**Phones (600px and narrower):** every box floats as a rounded glass pane inside the 16px gutter, the same as on
wider screens and like the scoreboard; cards use 12px padding and the buy-shares columns slim to 4rem / 3.5rem / 44px. Only
the signed-out hero runs edge to edge, merging with the top bar. (Before M9 polish, phone cards were square bands.)

## Words

Player-facing glossary (clarify pass, board t115): a **season** is the league year; a **tournament** is one event
(a stage in code); a **game** is one tournament game and its tally (a session in code). Every player-facing name,
number and status word comes from `src/app/lib/words.ts` (M15 P9), so each reads the same on every page:

- **Game names** (`gameName`): "Game 3", or "Game 3 vs UNC" once a keeper names the real opponent. Where the tournament
  matters too (the tally bar, the tally's Open games) it follows: "Game 1 vs Duke · CCCs" (`gameTitles`). Only older
  practice sessions fall back to date · kind. "vs" is also the word between two scores ("6 vs 4.5"), never "to".
- **Status words** (`statusWord` for League, `rowStatus` for Stats and tally rows): Not started, Live (the red `.live`
  dot and the word in caps), Finished · not verified, Final, Doesn't count (a started game whose tally was deleted). A
  verified game the scorer holds back because an earlier game isn't verified reads "Final" plus the note "counts once
  CCCs game 4 is verified". Live and not-yet-verified numbers keep the word "unofficial" next to them. The status is
  plain text, not a pill (P9 rule 5); pills are for what is wrong or needs you ("Out", "Your pick is out", "2 unsaved",
  "To verify"). Leaderboards' Past tournaments still mark a tournament with an unverified game by a "Waiting on stats"
  pill.
- **Stats in sentences** (`statWords`): "1 goal, 2 assists, 1 block", in the one stat order G, A, D, C, T (goal,
  assist, block, callahan, turnover; `STAT_ORDER` in `words.ts`). The letters G, A, D, C, T stay on tally buttons and
  table heads; stat tables put their columns in that same order (`inStatOrder`, whatever order the season's settings
  keys come back in), while the tally board keeps its own button order (keepers' muscle memory). Every stat table has
  the legend under it: "G goals · A assists · D blocks · C callahans · T turnovers". A starter with no line reads "no stats yet" until the game is verified; after it, "didn't
  play" (no line) or "no stats" (a line of zeros).
- **What a player counts for** (`factorWords`): share, rest and earlier tournaments in words, "20% · played game 1: ¾
  points · earlier tournaments: 90%". Rest (`restWords`): "rested", or "played game {n}: half / ¾ / ¼ / 60% points";
  when the season's tired steps repeat a value the game can't be told, so it says only "half points". The pick card
  says "Your 20% · …". In a calculation the share is exact to 3 figures (`pctExact`): "6 × 12.5%".

Buttons say the action and its object ("Save settings", "Change close time", "Reopen tally", "Delete these stats").
Errors say what happened and what to do; an unknown error shows its code only in brackets after that.
**Few small words** (board t231): small grey text only when it prevents a mistake, explains a state, or is required
(the donation terms). Controls and pills speak for themselves. Account-menu items have no subtitles.
**Share**: the part of a player a team owns, shown as a percentage ("You own 66% of Sam"); credits put on a
player buy shares, and a team scores that part of his points. **Buy shares**: the action that was the auction; the
card, the button and the admin controls all say "Buy shares" or "buying". Never "bid" or "auction" in player-facing
text (the code names `bids`, `place_bid`, `run_auction` stay).
**Opponent**: the real team our team plays in a game, in the game's name ("Game 2 vs Duke", for everyone) or as a small
"vs Duke" under a line that already names the game; unnamed games stay "Game 2". One exception: the team page's game
row names the fantasy team it plays in its title ("Game 2 vs Gimp Zeal") and gives the real opponent as the small
"vs Duke".

## Components

- **Top bar** (`.topbar`): black. Brand on the left, the account avatar on the right, and tabs: League, Stats,
  Leaderboards (the same three for everyone signed in). From 640px the tabs sit in the bar; tabs are muted until hovered, the current tab is white, and
  one 3px gold `.ink` marker glides under it when you switch (`useInk` in `src/app/lib/useInk.ts` measures the
  current tab). **On phones (under 640px) the same tabs dock at the bottom** within thumb reach (M9 t92): a frosted
  `--sticky-bg` bar of equal 48px tabs, the gold marker on its top edge, and the page padded by `--dock-height` so
  nothing hides under it (focused inputs scroll clear of it too). Safari keeps the dock clear of the iPhone home bar
  on its own (checked on a real iPhone, t128), so there is no safe-area padding. **On phones the top bar is sticky**
  (M15 P9): brand and avatar stay in reach on long pages; the buy card's `.bid-header` sticks just under it (the admin
  nav doesn't: on phones it scrolls with the page, see Admin), focus scrolls clear of it (`scroll-padding-top`), and the
  account menu is `position: fixed` so it opens under the bar. Over the tally board the bar scrolls away as before (the
  board never moves). Keepers reach the tally from a secondary Tally button in the Stats page head, from the League tab's live-game card ("Tally game 2")
  and from the tally games list (`/tally?game=<id>` opens that board directly), not from a tab. The dock is hidden while the
  tally board is on screen (`body:has(.tally-bar)`); `tokens.test.ts` guards that and the sticky bar. Deep routes light their tab:
  `/stats/*`, `/player/*` and `/tally` light Stats, `/team/*` lights Leaderboards; Me, Credits, Rules and Admin light none.
- **Account menu**: a gold avatar with the user's initial opens a native `popover` with the name and email, *Me*,
  *My credits*, *Rules*, *Admin* (admins), *Install app* (below), *Light mode* / *Dark mode* and *Sign out*. The avatar
  gets a baby blue ring while you're on Me, Credits or Admin.
- **Sign-in and Me**: the sign-in page says "We'll email you a 6-digit code." over "Email me a code". The first sign-in
  asks "What's your name?" (a `.card` with the Your name field) before any page; Me (`/me`) is the `h1`, the same Your name
  field with "Save name" (a `.success` "Saved." after), and the email reminders.
- **Install as an app** (M15 P8): *Install app* shows only outside the installed app, when the browser has offered to
  install (Chrome, Edge, Android: it opens the browser's own dialog) or on an iPhone/iPad, where it turns into the hint
  "Tap Share, then Add to Home Screen." (`.account-hint`, which takes focus). Inside the installed app the sign-in page's "Code
  sent" box adds "Type the code from the email here: its link opens your browser, not this app." (an iPhone gives the
  home-screen app its own storage, so a Safari sign-in doesn't carry over). A service worker (`src/sw.js`, production
  builds only) keeps the app's own files for offline starts; it never touches Supabase. A new deploy reaches an open
  installed app within two returns to the front (the first fetches it, the second reloads; at once on a fresh start),
  never while the tally board is on screen or the phone is offline.
- **`.page`**: a page's outer stack (16px gaps, a little extra space under the heading).
- **`.card`**: a smoked-glass pane (`--pane-*`), hairline border, 14px radius, 16px padding. `details.card` is a collapsible card
  with a drawn chevron.
- **`.section`**: a divided part inside a card: a top rule, not a new box.
- **`.stack`**: a plain vertical group with 12px gaps.
- **`.head` / `.meta` / `.row`**: title-with-actions row, wrapping inline details, and a wrapping form row.
- **Buttons**: gold with dark text by default. `.secondary` is a soft borderless `--surface-2` fill. `.linklike` looks
  like a link. `.button` makes a link look like a button. Buttons in a stack sit at their natural width, left.
- **`.danger-link`** (M15 P9): every destructive action (Undo game, Delete tournament, Delete league, Remove account,
  Remove a player, Remove a share, Delete season) is red underlined words (`--error`, a 44px target), never a filled
  button, and sits last in the sheet it belongs to, after the everyday actions. Each keeps its confirm, except Remove a
  share, which needs none (giving the share back undoes it). Disabled (your own account, a season name not typed yet)
  it greys to `--muted` words. It never lifts or squeezes and keeps the text lettering, not the button lettering.
- **`.list`**: on the page, each row is its own bordered box (min 56px tall). Inside a `.card`, rows become
  plain rows split by divider lines, and so do the rows of a list opened inside a page row (`.list .list`: admin's
  Later and Earlier tournaments open to their own rows). `li.used` greys the row's title (a "Used" pill says why).
- **The row is the button** (M15 P9 rule 1): anything that opens something is one whole-row target with a drawn chevron
  at its end, never a small button beside a row. `.row-link` is that row as a link or a `summary`: 56px, a `.who` first
  (a bold `b` name over `small` lines), pills after, the chevron last (a summary's own chevron, turned down when open).
  In a `.list li` it fills the row. A row that opens nothing (a game not started, a full league) is the same markup on a
  plain `div`, with no chevron. Used by the Stats games, the team page's game, Join a league, the tally games list,
  Open games and every admin row (see Admin). `.row-target` does it for a table or ranked-list row whose first link
  must stay a plain name: the link's `::before` stretches over the row (so an `a.row-link` inside keeps its `::after` chevron) and the focus ring sits inset
  on it. In a stat table the sticky first cell stops the stretch, so `StatTable` also follows a plain tap anywhere in the
  row (not a modifier click, another button or the end of a text selection). Used by stat tables with a link and by
  standings rows you can open.
- **Bullet lists** directly inside a `.card` (the rules page) have no margin and 8px gaps.
- **Rules page** (`/rules`): the `h1` "How Tribe Fantasy works", the same four steps as the guide, the `.notice` (free to play,
  donations, whose settings the numbers are), then six closed `details.card` folds, each `summary > h2`: The season, Credits and
  shares, Picks, Scoring, Standings points, Questions. Under 120 words show before the folds. Every number is derived from the
  season's settings (the defaults when signed out); the email timings and the 100 / 50-credit example stay literal text.
- **Banners**: the first-visit guide shows only on the League page, never on task screens like Tally.
- **`.pill`**: a rounded label that always carries its own words. Variants: plain (neutral), `.ok`, `.info`,
  `.warn`, `.bad`.
- **`.notice`**: an info pane, the same glass as every box but glowing blue (`--notice-bg`), for information and next
  steps: the guide, "Buying closed for CCCs…", a closed tally board, Admin's "Create a season in More › Season.". Who the
  app started and when picks lock are `.hint` text (small and muted), not notice boxes ("Ari Banks is out. Finn Garza
  plays."; M15 P9: they were boxes inside cards, and the pick card jumped). **`.notice.warn`** is the same pane in
  `--warn` on `--warn-soft`, for something that is wrong and holds other things back: only Admin's stuck-game warning.
- **`.success`**: green text with `role="status"` for a confirmed result. **`.error`**: red text with
  `role="alert"` for a failure, saying what to do next. **Loading** is the `Loading` component
  (`src/app/components/Loading.tsx`): a `.skeleton` pane in a card's shape (a title bar and two lines; inside a `.card`
  just the bars, never a box in a box) with
  `role="status"` and a hidden "Loading…" for screen readers (M9 t99), on every page, Me and the tally included.
- **`.segmented`**: a joined group of buttons with `aria-pressed`; the chosen one is inverted (text colour
  as background). Used for the Standings league / All leagues toggle (Leaderboards) and the team switcher.
- **`.subnav`**: Admin's group chips and sub-tabs (see Admin).
- **League tab** (`HomePage.tsx`, `TournamentCard.tsx`; layout A, M15 P9): top to bottom, the first-visit guide, a
  keeper's live-game card, the team switcher (2+ teams), then for the chosen team the matchup headline and strip, the
  scoreboard and starters, the pick card, the Buy shares card, the league's short table and the games; then the "Join
  another league" / "Create a league" `.more` links, and last a muted `details.settings` "League settings" fold. That
  fold always renders for your team and opens with Rename team first (`rename_my_team`: 1–40 characters, unique in the
  league), then Manage league and Leave. With no team this season, a keeper (admins included) sees the quiet line "You
  don't have a team this season." and a "Join a league" `.more` link; anyone else sees the "Get started" card (gold
  "Join a league", secondary "Create a league").
- **Matchup** (`Matchup`): per team, the game that matters now (live, else next, else last played). Once that game
  pairs you, a `.display` headline "TEAM vs OPPONENT" (`--fs-matchup`, shrinks on phones; the page `h1` is `.sr-only`
  once you have a team). Each name (`.side`) links to its team page with a
  quiet `--line-strong` underline that goes solid on hover or focus, and has its owner's real name under it in small
  muted sans text (`.owner`); no line when the owner has no display name, "Removed user" for a removed account.
  Unpaired or on a bye, the headline is just your team's name, unlinked. Under it
  one `.strip` line (rule 5): the game's name ("Game 2 vs UNC"), then "Bye", or the state: the `.live` dot (its ring
  pulses) and LIVE, "Next up" for the game to come (the strip's own word for it), "Finished · not verified", or "Final"
  with **Won +1.5** / **Lost −1**; a held game adds its "counts once … is verified" note; while the numbers are
  unofficial, the word "unofficial" and the verified `?`. A `.pill.warn` "Your pick is out" shows when a pick of yours
  won't play. No tournament name or dates in the strip. With no game to show it reads the league and season, "N teams"
  and, before any game counts, "No games yet".
- **Scoreboard and starters**: for a paired game, a black `.score` scoreboard: "Your picks" / "Their picks" before the
  start, "You played" / "They played" after; first names in the display face before scores exist ("No picks yet"; theirs
  read "Hidden" until the start), `--fs-score` numbers after (the unofficial numbers while the game is live or not
  verified), the losing side muted; your side's label and names turn green (`--ok-on-bar`) once your picks are set.
  Once the game has started, a `section.card.starters` lists each side: a `.head` with the team (`.by`) and its score,
  then one row per starter, "Finn Garza · 1 goal, 1 assist · 6 × 12.5%" with his points (a base of 0 stops after the
  stats), and under your side the `.hint` lines on who the app started for you. A chip `.since.up` (gold) or
  `.since.down` (`--error`) "+3" / "−2" shows on a row whose points changed since this device last looked, and stays
  until the next change (the sign carries the meaning, not the colour). A verified game shows the same block without
  "unofficial". A side with no starters reads "No starters" (the scoreboard too), or "No players" when the team has no
  roster this tournament. Never "Forfeit": the core has no forfeit rule (an empty side scores 0 and can tie or win).
- **Keeper's live game** (`LiveGame` in `HomePage.tsx`): while the current tournament has a started, unfinished game with
  a tally, a keeper (admins included) sees a `.card` with the `.strip` "CCCs · Game 2 vs UNC" and the Live dot, then
  "Tally game 2" to `/tally?game=<id>`: a gold button for a keeper with no team this season, a `.more` link otherwise
  (one gold button at a time). While it shows it refreshes (Live refresh), so it goes once the game is finished; a
  failed first load shows no card, a failed refresh keeps it.
- **Pick card** (`PickGame`, `article.card` "Next game"; P9 rulings 5–7): the head `h2` "Pick 2 for game 3" (+ " vs UNC"
  once named), the `?` on a player's points and `strong.num` "1 of 2". Then one line: "You play Layout Legends." (the
  name links to its team page) or "Bye in game 3: no opponent, so your standings points don't change.", and the `.hint`
  "Picks lock when a keeper starts game 3." While the game isn't paired yet you can still pick (it gets paired when
  the game before it finishes): the line is only the hint, "You'll see who you play once game 2 ends. Picks lock when a
  keeper starts game 3." (game 1 has just the lock sentence). Then every roster player A→Z as a `button.pick-row`, the
  whole row the toggle (`aria-pressed`): the name (an Out `.pill.bad` if a keeper marked him out), under it small "Your
  20% · played game 1: ¾ points" (`factorWords`, from the core's numbers, never the UI's), and a drawn ring at the end
  that fills green (`--ok`, the name too) when picked; tap again to clear. With every slot full the other rows are off
  (muted) and a `.hint` says "You have 2 picks. Clear one to change."; an unpicked Out player's row is off too (a
  picked one stays on, so you can clear him). A save holds further taps until its reload lands and shows the new set as
  picked meanwhile (cursor: progress). If the save went through but that reload fails (weak signal), the saved set
  stays shown and is what the next tap builds on, until a load succeeds; a tap never sends a set older than the last
  save. Under the rows, `.hint` lines name who plays for an Out pick or an empty slot ("Ari
  Banks is out. Finn Garza plays.", "If you don't pick, Finn Garza plays."). A bye keeps the rows (bye starters still
  count toward total score and still tire). A team with no players this tournament sees the game's name and "You have no
  players this tournament, so you can't score."; a team that joined after the game was paired, "You joined after game 3
  was paired, so you start the game after it." There is no Tired pill and no bench.
- **Buy shares card** (`AuctionCard`, while buying is open; between close and settling it is the single notice "Buying
  closed for <tournament>. Your players show here once the shares are settled."; after settling the pick card lists the
  roster). Credits are "credits left of N" in the sticky `.bid-header`, which reads "N of 6 players" with the shares `?`,
  a `.pill.info` Closes pill and a "Get more credits" link to the Credits page. Once credits left drop
  under 10% of the balance (or 2 minimum buys) that link becomes a gold button (t234). Under the header, buys over the
  balance show an alert notice. Credits an admin grants or adds by hand arrive silently, and a team with 0 credits sees
  nothing extra: no late-joiner notice, no "an admin added" line, and no late-joiner prompt in Admin either (P9 Round
  2, the user's call). The list puts players you'd bought when the page loaded first; the order stays put while you buy (t237). A player row has the credits input
  and Buy / Save (and × to remove); at 6 players the other rows lock. After a save, that row shows `small.success` "Saved:
  40 credits on Ari Banks." until the next save anywhere. A player you started in earlier tournaments carries a `.pill.warn`
  "×0.9" (labelled "started in an earlier tournament: 90%"). "Buy shares" (`details.bid-cta`) reads as a full-width button:
  solid gold before your first buy (`.loud`), gold-outlined after. Open, it's a plain fold header. Above the rows a `.hint`
  "Points a game at <tournament>, the last tournament. Tap a name for game by game." (the last tournament = the most recent
  other tournament with a final game; no such tournament, no line and the names stay plain); each name links to
  `/player/<id>?t=<stage>` and, under it, a small "N a game" (that tournament's average, a game without his line counting 0;
  nothing for a player with no lines, never "0").
- **League table** (`LeagueTable`; rule 6, show the league): an `article.card` titled with the league's name, a "Full
  table" `.more` link to Leaderboards, and the short ranked list (`RankList short`, the `.ranks` look below): the top 3,
  plus your row and the rows just above and below it; each skipped run is one gap row "N more teams". Every row opens
  its team. Before any game counts the card shows only "Standings start after the first game." (no rows, no Full table).
  It replaced the Place / Record / Points tiles.
- **Games** (`GameList`; rule 4, one line per game, grouped by tournament): a `section.card` with `h2` "Games". First
  the current tournament (the one the next game is in, else the newest with a started game) under its name as a plain
  label, every game of it on one `.game-line`: the number in the display face; both teams with their scores
  right-aligned, yours first and the loser muted (or "Bye", "Not playing", "Not paired yet"), with a small "vs Duke" and
  any held note under them; and at the end the state: the status word (Live with its dot, "unofficial" under it while the
  numbers are) or, for the next game while you have picks to make, gold "Pick 2" (`--gold-text`; it reads "Not started"
  once your picks are in). Then "Earlier": each earlier tournament you played in folds to one `details` row "Feasterns ·
  4 games · 2–1" that opens to its lines; tournaments you weren't in aren't listed. Before a tournament opens, with none played before, no card. A started
  game's line is a `details > summary.game-line` with the chevron at its end; an unstarted or void game's line opens
  nothing and has none. Long names and emoji wrap; nothing scrolls sideways at 375px. Lines don't link team names and
  carry no W/L ±points (the strip and the table have them).
- **Opened game** (`GameDetail`): your matchup first, both sides (`SideDetail`): a `.head` with the team (`.by`) and its
  score, the `.hint` lines on who the app started, then one row per starter, "name · stats" and a `.calc` "base × exact %
  = points" ("6 × 12.5% = 0.75"; a base of 0 shows just the 0). The side score is the sum. A side with no starters reads
  "No players" on a bye or when the team has no roster this tournament, and "No starters" against a team (never
  "Forfeit": an empty side scores 0 and can tie or win); a bye's missing side reads "Bye". Then `h3` "Other matchups", one
  folded line each ("Huck Finn 1.5 · Layout Legends 1.5") that opens to its two sides. An unofficial game ends with the
  `.hint` "Unofficial until a keeper verifies."
- **`.by`**: a side's team name heading its starters (the starters block, an opened game); it wraps.
- **First-visit guide** (`Guide`, `aside.notice.guide`): above everything else on League, an `h2` "How it works", the four steps
  (`GuideSteps`, `ol.guide-steps`: Get a team, Buy shares, Pick N each game, Higher score wins) and a row with a secondary "Got it" button and an
  "All the rules" `.more` link to `/rules`. Shown once per account and device: "Got it" stores `tribe.guide.<uid>` = `1`, and the
  guide stays hidden after that; existing players see it once too. Blocked storage (private mode) shows it every visit and "Got it"
  hides it for this visit only, with no error. "Got it" moves focus to the page `h1` (even when it is `.sr-only`). The Rules page
  always opens with the same steps, so there is no "show again". The pick count comes from the season's settings.
- **Team switcher** (`.segmented.team-switch`): with 2+ teams this season, one team at a time; each button is named by
  its **league** (the team name is the headline below). The choice is remembered on the device and shared with the
  Credits page. Long rows scroll sideways rather than squeeze. Only the current season's teams are listed (all of them
  if none are this season's, t240). A gold `.needs` dot marks a team that needs you: fewer picks than a game takes (2, or your whole roster if smaller)
  for its next game, or open share buying you haven't bought in. When a dotted league is scrolled out of sight, that edge of the switch glows gold and
  pulses (`.team-switch-wrap.glow-left` / `.glow-right`; steady with reduced motion).
  When the chosen team doesn't need you and every dotted league is scrolled out of sight, the first one scrolls into view once the dots load (once, never on scroll); the glow stays.
  A mouse wheel over the switch scrolls it sideways; at either end the page scrolls.
- **`?` help** (`Help.tsx`, `.help`): a 44px target around a 22px `--surface-2` circle (a hairline `--line-strong` ring in
  light mode), opening `.help-pop`, a native `popover`
  with the notice's raised shadow (the browser centres it in the top layer; Esc or a tap outside closes it; nothing positions it, so it never overflows at 375px).
  Three texts, every number from the season's settings: **shares** ("How buying shares works": credits buy a slice of a
  player, each player is N shares, slices shrink to fit when teams put in more, free credits each tournament carry over)
  in the Buy shares head; **a player's points** ("How a player's points count": you score your share of his points, the
  tired steps as "half" and "¾", and how much each earlier tournament takes off, down to the floor, sampled after any
  free ones, "The first 2 earlier tournaments you started him in are free; each one after …"; no such sentence when
  earlier tournaments take nothing off) in the pick card head and beside "Players" on the team page; **unofficial and
  verified** ("What unofficial and verified mean": keepers tap live so scores move, a second keeper checks them and
  then they're final, a final game can be reopened for N hours, a sentence dropped when N is 0) after "unofficial" in
  the League strip, at the end of the Stats live strip, and beside the Stats "Games" heading while a game there reads
  "Finished · not verified" and no live strip shows. The Credits page and game lines have none.
- **Credits page** (`/credits`, `Credits.tsx`; account menu, or Get more credits while buying shares): the `.money` card of the team chosen
  on the League tab (same `.team-switch`, same remembered choice), titled by the team name. Each card is always open, the balance as the big number in its head. A green
  `.success` thanks a donation from the last week while it's the newest entry. "Donate for more": `.amounts` chips
  $5 / $10 / $20 with the credits under each (the chosen one baby blue, a selection, t238), one full-width gold
  `.button.go` "Donate $N on Venmo", and **right under it the terms** (a donation to the team fund, no cash value,
  can't be refunded, no guaranteed prize: read before paying, t233). Then `.team-code`, "Venmo note: TribeF - CODE" beside Copy code, whose message is a `role="status"`. Credit history is a folded `.section`. With donations
  off, the card is the balance, the terms and the history.
  Under it, while the season takes donations, a **Donors** card: the season's donors across all leagues, biggest
  total first, as a plain divided `.list` of "N. Name … $X" (not `.ranks`: no standings place; equal totals list by name), "(you)"
  muted on your row, "Anonymous" for hidden names, then a "Show me as Anonymous" `label.check` that flips at once and
  rolls back on a failed save. Hidden with donations off.
- **Leaderboards tab** (`LeaderboardsPage`, `/leaderboards`): the team chosen on the League tab (same `.team-switch`, same
  remembered choice), then its Standings card, then the Past tournaments card.
- **Past tournaments** (`PastTournaments`, Leaderboards): one `details` per tournament with a started game, except the one
  being played, newest first. The summary holds the name, the dates and, while a game is live or pending, a "Waiting on
  stats" `.pill.warn`; it wraps under a long name at 375px. Open, it is a ranked list like Standings (points gained in
  the final games, byes included, ties by total score), or "No results yet." when no game counted. No per-game list.
- **Team page** (`TeamPage`, `/team/:membershipId`): the team name as the `h1` with a back link at the head's end ("←
  Back" when opened from another page of the app, "← Leaderboards" when opened directly), the owner and league ("Maya
  Lin · League A") under it. Then the team's game that matters now (its live game, else its next) as one row: "Game 2 vs
  Gimp Zeal" (the team it plays), the scores "0.45 vs 1.35" (" · unofficial" while not verified), "Bye", or the real
  opponent as a small "vs Duke", and the status word at the end; once the game has a tally the row is a `.row-link` to its
  game page, before that a plain row. Then `h2` "Players" with the `?` on a player's points, and its players A→Z as
  `.list` rows: the name and small "15% · played game 1: half points" (`factorWords` for the next game). No picks,
  credits or prices. No next game: "No tournament on. Players show once the next tournament's shares are settled."
  No roster: "No players this tournament." A removed team reads "(removed)" and "No players." Only that league's
  members (current season) and staff can open it; anyone else, an unknown id or a malformed one sees "You can only see
  teams in your league." with a Leaderboards link. It loads the live game's taps and refreshes while any paired game
  of its league is live (not only its own); a failed refresh keeps the page under the error.
- **Team links**: a team name links to its page from standings rows (the whole row; in All leagues only your own
  league's rows), the League tab's short table, past-tournament rows, both names in the League matchup headline and
  "You play X" on the pick card. Not game lines. Links inherit the text colour and underline on hover and focus.
- **Standings** (`.ranks`, on Leaderboards): a ranked list. Rank and points in the display face, the rank muted and yours in
  `--gold-text`; the team with its owner's real name and record under it ("Maya Lin · 2–1"; "League · Maya Lin · 2–1" in All leagues). A `.segmented` [league]
  [All leagues] toggle shows only when the season has 2+ leagues. Before a verified game this league was paired in (a bye counts) the card shows only "Standings start after the first game." (no rows, no
  toggle); this overturns t239, "a leaderboard from day one", per the M15 spec (§5.7). A long list keeps the top 5, everyone tied with 5th and your row,
  and only cuts when that hides 4+ teams: each skipped run is a visible gap row "N more teams", and a secondary "Show all
  N teams" opens the rest. Ties list by team name. A row you can open is a `.row-target`: the whole row opens the team.
- **Join a league** (`LeaguesPage`, `/leagues`): one `.card` list of the current season's leagues (a "Search leagues"
  field once there are more than 6). Each row names its members by first name and counts the teams: "Maya, Gabe, Rory
  and 2 more · 5 of 12" (just "0 of 12" with no names), with a "Password" pill when it has one. A league you can join is a
  `details` whose `summary.row-link` opens the form in the row ("Your team name", Password if needed, gold "Join League
  A"; one open at a time). A league you're in ("Joined", `.pill.ok`) or a full one ("Full") is a plain row with no
  chevron. "Create a league" is a `.more` link under the card.
- **`.steps`** (P9 rule 2): a real sequence as one line of small muted words split by " · ", the step at hand bold in
  `--fg` (`.now`, `aria-current="step"`), its one gold button under the line; done steps read as words. Used by admin
  Tournaments: "Allowance given · Buying open, closes in 1 d 4 h · Settle · Start".
- **Fold the rare forms**: forms used once a season or less (Add a tournament, New season, Rename or delete a season,
  Settings' Advanced JSON) live in a collapsed `details.section`, open by itself only while there is nothing yet (no
  tournament, no season).
- **`.more`**: a secondary way on, an underlined text link with a drawn chevron that nudges right on hover.
- **`.hero`**: only on the signed-out home page, the one page that has to sell. Black panel, 40px headline,
  gold call to action, and the team crest ("A Tribe Called Tech", white + gold version for dark, `team-logo.png`, t131)
  whole in a second grid column beside the tagline and buttons; on a phone, smaller, beside the tagline only (t132). On top, `.hero-photo` (t94): the team photo with family, friends and
  alumni, cropped to the people (`src/app/assets/team-800.jpg` / `team-1600.jpg`, srcset), bleeding to the panel's
  edges with its sky and grass masked into the dark, and a one-line thank-you caption under it.
- **Tables** (`.table-wrap`): 14px tabular figures, right-aligned numbers, first column left, divider rows.
- **Stat table** (`.stat-table`, `StatTable.tsx`; Stats, the player page and the game page): headers are `.linklike` sort buttons with
  `aria-sort` and an arrow (points high-first by default, Player A to Z, a second tap flips); they keep their look on
  hover and press. Heads are G, A, D, C, T (always in that order, as the legend reads) and Pts (the full name is the
  accessible one), and the `.hint` legend sits
  under the table ("G goals · A assists · D blocks · C callahans · T turnovers"; off for the per-keeper tables, whose card
  already has one). The table scrolls sideways inside `.table-wrap` while the player column stays put (sticky); that
  column is see-through until the table scrolls under it (`.scrolled`), then takes an opaque fill: `--bg` on the page,
  `--card-solid` (the card glass flattened, in `tokens.css`) inside a `.card`. With a link per row the whole row is a
  `.row-target` that opens the player. The player page's Total sits in a `tfoot` outside the sort. No rows: "No stats recorded."
- **Stats page** (`StatsPage`, `/stats`): the `h1` "Stats" with the season as small text and, for keepers, a secondary
  Tally button; the tournament switcher (a `select`, kept on screen and focused while the next tournament loads); while a
  shown game is started and unverified, a `p.strip` with the verified `?`: for unfinished games the Live dot and "Live ·
  includes game 2, not verified yet" ("games 3 and 4", "games 2, 3 and 4"); for games a keeper finished but nobody has
  verified, no dot and "Not verified · includes game 2" (both parts when both kinds are open, each naming only its own
  games). The table totals include those games' live lines; the tournament's table ("No stats yet for CCCs." while
  empty); then `h2` "Games" and one `.list` row per game, "Game 1 vs Duke" with its status word (and, for a keeper, a
  "2 unsaved" pill while this phone holds taps for it). A started game's row is a `.row-link` to its game page, or to its
  board (`/tally?game=<id>`) while it shows "2 unsaved" (only the board sends those taps, as on the tally games list);
  one not started opens nothing. Admins get a secondary "Download CSV" under the list (also before the season's
  first tournament).
- **Player page** (`PlayerPage`, `/player/:athleteId`): the player's name as the `h1` with "← Stats" (back to that
  tournament), the switcher, and the tournament game by game ("Game" column, not sortable): every verified game (zeros
  where he has no line), a started unverified game with its live numbers, "Game 3 · live, not counted yet" while it is
  unfinished and "Game 3 · not verified yet" once a keeper finished it, and a Total
  of the verified games only. It refreshes while a game is live.
- **Game page** (`SessionPage`, `/stats/:id`): "← Stats", the `h1` "Game 1 vs Duke" with the tournament as small text, and
  the status word (plus a "Not counted" pill for a session that doesn't count). While the game is live or not verified,
  members see its unofficial lines in a "Stats unofficial" card (refreshing). A verified game shows its "Stats" table,
  with Reopen tally (keepers, within the lock hours) or Correct a stat line (admins, once locked). Keepers on an open game
  see "Totals to verify", "Counted once" merges, a "Tallied by …" fold per keeper, Verify these totals (or the notice
  "Another keeper must verify." if they tapped it), and "Back to tallying". The rows of the live, verified and to-verify tables open the player page.
  Admins get "Delete these stats" (confirmed).
- **Stats outside a league**: a signed-in account that can't read league data (no league, or athlete-only; checked with
  `can_read_league_data()`) sees the `h1` and "Join a league to see stats." with a "Join a league" button to `/leagues`: no
  switcher, table, live strip or games. While the check is unknown the page is loading; if the check fails the usual page shows.
- **Live refresh**: reload every 15 s while the tab is visible, at once when it becomes visible again, keeping the old
  numbers on screen until the new ones arrive (a failed refresh shows the error above what is already there): the League
  tab (while any of the league's games is live or not verified and has pairings), Stats and the player page (while a
  shown game is started and unverified), a game page for members (while it shows live lines) and a team page (while its
  league has any paired live game), and the keeper's live-game card on League (while it shows). Nothing else polls.

## Tally board

- **The games list** (`/tally`, keepers; it keeps the app's own theme), top to bottom. The tournament card
  (`GameControls`): a `.strip` "CCCs · Game 2 vs UNC" with the status word, then the one gold action: "Start game 2"
  (it asks "Start game 2 vs UNC? Every team's picks for it lock now.") or, while the game is live, "Tally game 2"; an
  over tournament says "CCCs is over after game 6." with no button. A live game whose tally was deleted says "Its tally
  was deleted, so it won't count. Finish it to pair the next game." with Finish (no board exists to finish it from).
  A failed Start, Finish or load shows its error right under that action line. Under it one `.row-link` per game of the tournament, "Game 1 vs Duke" over its status word: a live game, or one with
  this phone's unsent taps (a "2 unsaved" pill), opens its board; a finished one opens its game page, with a
  "To verify" pill while it isn't verified; a game not started (or whose tally was deleted) opens nothing. Then the
  closed `details.card` "Opponents": one form, a "Game k" field (placeholder "Opponent") for every game, started or
  not, and one secondary "Save opponents" that saves the changed ones (a failed save shows its error in this fold,
  under the button). Then "Out · <stage>" for marking before a tournament: rows "name · from game N" with Clear,
  "Nobody is out." when empty, then a Player select and a secondary "Mark out". No confirms: Mark out and Clear undo
  each other. Last, "Open games": other tournaments' unverified games and any other session with this phone's taps, as
  rows to their boards; the current tournament's games (unsent taps included) sit on the tournament card instead. It
  hides when empty.
- **The bar**: a sticky `.tally-bar` in two rows: "← Games" and the game's name ("Game 4 vs Wake Forest · CCCs"), then
  the sync pill (Saved ✓ / Saving · 2 unsaved / Offline · 2 unsaved, in words) and a "Bright board" checkbox
  (`label.check`, `--check`). "← Games" opens the games list as a new history entry, so Back from it (or from a page
  opened after it) returns to the board. There is no undo button: holding a stat button (~500 ms) takes one of your own
  taps off, with a buzz and an inverted flash (`.minus`) so it never reads as a tap; the board says "Hold a stat to take
  one off." Minus, Delete or Backspace does the same from the keyboard.
- **Who's on it**: a "Find a player" search, then `h2` "Picked this game" (every player any team starts in this game,
  from the core) and `h2` "Everyone else", both A→Z; the search filters both and hides the headings. The board waits at
  most 1.5 s (`STARTERS_WAIT_MS`) for the picked group on its first load; if it isn't there by then, or fails, the board
  is one A→Z list for the rest of the visit, so the list never regroups under a keeper's thumb.
- Each player is a `.tally-card` (on the bright board `--surface-2`, since page and cards are both white). Stat buttons
  are big neutral tiles (at least 76px tall, 56px wide) with the
  label on top, the count large in the middle and the points small below. They are not gold; gold is only the press flash.
  "On your team" (a plain pill) greys a keeper's own players' buttons: another keeper tallies them.
- Negative stats use a dashed border so the difference is not colour alone.
- Tally buttons never animate. A tap must show instantly, even when other buttons fade.
- The board is bright by default for daylight (see Colour). The "Bright board" checkbox switches it at once, with
  nothing fading, and the phone remembers the choice (`tribe.tally.bright`).
- The Out control sits apart in the card header, never among the stat tiles: "Mark out", or an "Out" `.pill.bad` with
  "Clear out". A player who is out of this game folds to that one line, with no stat buttons (clear the Out to tally
  him); one marked "Out from game N" for a later game keeps his buttons. It is hidden on a closed (verified or
  earlier-season) board. Nobody marks their own attendance or injury any more; keepers mark Out (M15 P5).
- **Finish** sits at the end of the live game's board, after the players, as a quiet secondary "Finish game 4"
  (off while this phone has unsent taps). For a game before the last it opens a question in place: "Finish game 4 vs Wake
  Forest? Game 5 gets paired; an admin can undo it." with a closed "Game 5 pairings" fold, then gold "Finish game 4" and
  Cancel. The last game asks "Finish game 6? It's the last game: CCCs ends." Neither the button nor its fold moves
  (`tokens.test.ts`).

## Admin

`#/admin` (`AdminPage` and its panels in `src/app/pages/admin/`; admins only, anyone else is sent home), one section at
a time (M15 P9 Round 2).

- **Heading**: the `h1` "Admin" with the managed season as small text (`h1 small`). Admin manages the newest season
  unless More › Season picks another (a deleted pick falls back to the newest); every section remounts when the season
  changes, so Settings never saves one season's settings onto another. With no season, Accounts, History and Season
  still work and the other sections show the `.notice` "Create a season in More › Season." with the link.
- **Nav** (`.subnav`, P9 ruling 17): four group chips in one row, most-used first: **Tournaments**; **Teams** ›
  Leagues, Wallets; **People** › Accounts, Players; **More** › Settings, History, Backup, Season. The chips are buttons
  with `aria-pressed` in a `nav` "Admin sections"; the pressed one is filled `--fg` on `--bg` like a `.segmented`
  choice (no ink marker), and a chip opens its group's first section. A group with more than one section adds a row of
  text sub-tabs: links with `aria-current="page"`, muted until hovered or current, the current one `--fg` with a 3px
  gold underline. Neither row scrolls sideways, so nothing hides past an edge (t126); at 375px the four chips fit one
  row. On phones the nav scrolls with the page instead of sticking under the top bar (ruling 67: chips and sub-tabs
  under the bar took a quarter of the screen); the nav heads every section and each section keeps its scroll.
- **Addresses**: `#/admin?tab=<id>` with ids `stages`, `leagues`, `wallets`, `users`, `athletes`, `settings`,
  `history`, `backup`, `season`; a missing or unknown id opens Tournaments. Each section keeps its scroll for the
  visit: coming back restores it, and a section still loading is followed as it grows back to the saved spot until it
  gets there or the admin scrolls (wheel, touch or a key).
- **Stuck-game warning** (P9 ruling 18): above every section, one `.notice.warn` per game whose tournament's last day
  has passed and which started but isn't verified (`stuckGames`, `src/app/lib/adminWarnings.ts`; a void game holds
  nothing back): bold "Feasterns game 4 is still live." (or "… isn't verified.") then "Later results won't count until
  it's verified.", and the link "Open Feasterns game 4" to its game page (`/stats/<session>`), where Verify makes it
  final even unfinished. It loads each time Admin mounts.
- **Rows that open** (rule 1): every league, wallet, account and player, every tournament under Later and Earlier and
  each tournament's own Games and count, Pairings and Name and dates is one `.list` row: a `details` whose
  `summary.row-link` holds a `.who` (bold name over small lines; a wallet adds its balance), opening in place to that
  thing's actions as a `.stack`, everyday ones first (secondary buttons and forms), the destructive one last as a
  `.danger-link`. Leagues, wallets, accounts and players open one at a time (`details name`).
- **Tournaments** (`StagesPanel`): the tournament in progress (the earliest one that isn't over; over = its last day
  has passed or every game it has is finished) is a `.card` with its name and dates in the head, then its `.steps`
  line, "Allowance given · Buying open, closes in 1 d 4 h · Settle · Start" (once done: "Shares settled", "Game 2 of 5
  live" or "next", "Finished after game 5"), and under it exactly one gold button, the step due now: **Grant
  allowance** → **Open share buying** (with its Buying closes field) → **Close buying now** → **Settle shares** →
  **Open tournament** (with its Games field); none while games run, since keepers run them from Tally. Anything else on
  the card is secondary (Change close time while buying is open). Close buying now confirms "Close buying for CCCs now?
  Teams can't buy or change shares after this, and it can't be reopened."; Settle confirms that it runs once; Grant
  allowance asks first while earlier games aren't final; a past closing time is refused before any confirm. Each
  result or error shows inside its tournament ("CCCs: credited 6 teams."). Below the card, `h2` "Later" (tournaments
  made ahead of time) and `h2` "Earlier" (over ones), newest first, one row each: the name and dates and, for an over
  one, "Finished" or a `.pill.warn` "Game 4 live"; a row opens to the same steps with no gold button. Each tournament
  ends with its rows: **Games and count** ("5 games · 2 opponents not set"; on the tournament being played the Games
  field with Save count, never below the highest started game, raising an over tournament confirms the new game's
  pairings and lowering doesn't; a `.more` "Opponents are set on Tally"; and, on that tournament, "Undo game 2" (its
  newest started game) last), **Pairings** (Check
  pairings re-runs each Finish's Swiss pairing against the standings it was made from) and **Name and dates** (Save
  tournament; "Delete tournament" last). The "Add a tournament" fold comes last, open while the season has none and
  gold only while no tournament is in progress.
- **Teams › Leagues** (`LeaguesPanel`): a `.card` "Leagues", one row per league: its name, "Needs a password" or "Open to
  anyone" (the current season only; an older season's lock is unknown) and "5 teams · Made by Maya" ("an admin" with no
  creator, "a removed user"). Opened: its teams by name, a secondary "Open league", the password form ("New password"
  with "Add a password" or "Change password", and "Remove password" unless the league is known to be open), and
  "Delete league" last. Leagues are created on `/leagues/new`, by anyone; Admin only deletes them.
- **League browser** (Open league, M14): the league's name with a secondary Back; while share buying is open, "Buys so
  far" (sealed from members); then a `.card.team-card` per team: its name, owner, place and record, balance, shares
  and picks for the next game. Each share is a "{Player} (%)" field with Save and a red "Remove" (no bare ×), Add gives
  a new share once the tournament's shares are settled ("Close share buying first" before), and Rename renames the
  team. A removed team is read-only. Admin changes never move credits. Its Games card names each game with its pairings
  ("Game 1 vs Duke · Zeal vs Flow"; a live one with its unofficial score).
- **Teams › Wallets** (`WalletsPanel`): a `.card` "Wallets", one row per team, A→Z within each league: the team, its
  league and its balance. Opened: its last 5 ledger lines ("No credits yet." when none), the Adjust form ("Credits
  (+/−)", Note, gold Save; "Adjusted Gimp Zeal by 25." under its own Save) and, with donations on, "Only once the
  treasurer has the money." with a secondary Record donation. Every control's accessible name says its team. Venmo
  receipts that didn't become credits follow the list.
- **People › Accounts** (`UsersPanel`): a `.card` "Accounts" with the count and Search people, one row per account: the
  name (or the email) over its roles in words ("Admin, Stat keeper") or, with none, its teams ("Gimp Zeal · League A").
  Opened: the email, the three role checkboxes (Admin, Stat keeper, Treasurer; off while a change is in flight), the
  Name field with Save name, and "Remove account" last, its confirm naming every team, donation, profile and role it
  touches (off on your own account). Unticking your own Admin confirms first ("Remove your own admin role? You lose
  Admin right away and can't give it back yourself; another admin has to."), the one role change with no undo.
- **People › Players** (`AthletesPanel`): a `.card` "Players" with the opted-in count, one row per player: the name and
  "Opted out" when so. Opened: Linked account (a select), Opt out / Opt back in, the Name field with Save name, and
  "Remove" last (its confirm, and a second one when he has stats, shares, roster spots or picks). "Add player" sits
  under the list.
- **More › Settings** (`SettingsEditor`): labelled number fields in two groups, `h2` "Points for stats" (Goal, Assist,
  Block, Callahan, Turnover; fractions allowed) and `h2` "Credits and picks" ("Credits for the team in first"
  (`allowance_base`), "Extra for the last-placed team", "Players a team can own", "Picks each game"; whole numbers),
  two to a row on phones. Every setting stays editable as JSON in the "Advanced (all settings as JSON)" fold. One gold
  "Save settings" checks with `parseSettings` and lists what's wrong; a field edit and a JSON edit are never both
  pending (editing one puts the other back to the saved value).
- **More › History** (`HistoryPanel`): a `.card` "History": an Action filter (All actions, or one by its plain name:
  "Settle shares", "Close share buying"), one `.list` line per audit row ("Gave Ari Banks 25% to Gimp Zeal", "Tallied
  Game 2 vs UNC (CCCs)", "Closed share buying for CCCs") with the actor ("Automatic" for the system, "Removed user")
  and the time as small text, and "Load more" for the next 50. Names come from the live tables of every season, so a
  removed team keeps its name; a game is found by its game id or its tally's.
- **More › Backup** (`BackupPanel`): "Download backup", then "For the treasurer": Ledger CSV and Standings CSV
  (secondary).
- **More › Season** (`SeasonsPanel`): a `.card` "Seasons", one row per season with its status, "Managing" on the managed
  one and a secondary Manage on the others; then the folds "Rename or delete {season}" (Delete season unlocks once the
  name is typed; deleting the newest says which season everyone sees next) and "New season".

## Rules

- **No box inside a box.** Inside a card, use `.section` rules and divided `.list` rows, never another bordered box.
- **44px targets.** Every button, input, link-only line, summary and checkbox row is at least 44px tall.
- **Colour is never the only signal.** Pills carry words, negative tallies are dashed, the current tab is
  underlined, errors are written out.
- **Gold means act.** Use gold for the main action and the current place, not for decoration or long text.
- **One gold button at a time** (M15 P9 rule 2): gold is the one action due now (Start game 2, Tally game 2, the first
  Buy shares, Join a league, the tournament step due in admin Tournaments); a step that is done becomes words (a game line's "Pick 2" turns to "Not started"), and
  the other ways on are `.more` links or secondary buttons (a keeper with a team gets a `.more` "Tally game 2").
- **The row is the button** (rule 1): see `.row-link` and `.row-target`. **One line per game, grouped by tournament**
  (rule 4): League games, Stats games and the tally list. **Status is a word and a dot** (rule 5) and **say it the way
  people count** (rule 3): see Words. **Show the league** (rule 6): the League tab's short table.
- **Destructive actions come last, in red words** (`.danger-link`), each with its confirm or an undo (doing it again).
- **Text on gold is always `--on-gold`.** Links and focus are baby blue (`--link`).
- **Depth**: floating panes (cards, the scoreboard, the account menu, the sticky buy-shares header and the admin
  nav) are frosted glass: `--pane-bg` layered fill, `--pane-highlight` top edge, `--pane-shadow`, `--pane-blur`, over
  a faint gold and blue `--bg-ambient` glow on the page; each pane has a gold glow in its top-left corner, like the
  scoreboard. Page-level list rows get the same fill and shadow without the blur. Rows inside panes
  and the tally board never blur (phone GPU).
- **Button lettering** (user's pick, board t112): Archivo bold at a narrow 78% width, all caps, 0.06em tracking,
  14px (`--font-button`, `--fw-button`, `--fs-button`, `--button-stretch`, `--button-case`, `--button-track`), like a
  jersey label. Text links, account-menu items and the whole tally card keep their own lettering.
- **Disabled buttons** are a quiet `--surface-2` fill with `--muted` text, not faded gold. Pick rows keep their own look:
  an off row is muted text with no fill, and a pick being saved already shows as picked. A disabled `.danger-link` is
  just `--muted` words.
- **Buttons are flat and crisp** (user's pick over keycap, push-key, glow and metal styles, board t111): plain fills,
  no border or bevel. Hover lifts 1px and gold buttons glow (`--shadow-lift`); press squeezes to 95% and springs back
  (`--dur-release`, `--ease-spring`). Chips, segmented buttons, the `?` and pick rows don't move: a pick is its ring
  filling green, with no pop.
- **Motion is small and physical**, and only when the user has not asked for reduced motion: 150ms colour fades
  (`--dur`), every button squeezes to 95% while pressed (`--dur-press`), gold buttons rise 1px with a gold
  `--shadow-lift` on hover, and tab markers glide (`--dur-slide`, `--ease-glide`). The account menu and every opened
  `details` drop 8px in and fade (`--dur-menu`; closing is instant), page content fades in as it arrives
  (`--dur-fade`), and loading skeletons breathe (`--dur-rest`). On the League matchup the scoreboard numbers count up to a new
  value (`--dur-count`; the starters' team scores stay plain) and a "since you last looked" chip pops in; with reduced motion
  both just appear. The tally board never moves: no transitions, no press
  scale, no lift, no fade-in, and a fold opened on it doesn't drop in (`tokens.test.ts` guards all three).
- **Focus is always visible**: a 3px ring in `--focus`, offset 2px.
