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
| `--gold` | #f5b700 | Actions: primary buttons, current tab underline, text selection, checkboxes, the disc, the avatar |
| `--gold-deep` | #c99400 | The ring in the disc mark |
| `--gold-hover` / `--gold-press` | #ffc629 / #dba300 | Button hover and press |
| `--on-gold` | #111111 | Text on gold. Never white. |
| `--gold-text` | #f5b700 (light #8a6400, about 5:1 on white) | Gold as text: your rank in Standings |
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
| `--ok` / `--ok-soft` | #7fd69a / #16301f | `.success`, `.pill.ok`, a chosen pick |
| `--warn` / `--warn-soft` | #f4b566 / #3a2a13 | `.pill.warn` |
| `--error` / `--error-soft` | #ff8a80 / #3b1a18 | `.error`, `.pill.bad`, the Live dot |

## Brand mark

`DiscMark` in `Layout.tsx`: a disc seen from above. Gold circle, darker gold ring (#c99400), baby blue centre.
The same drawing is the favicon in `index.html`; change both together. It sits at 24px beside "Tribe Fantasy"
in the black top bar. The signed-out hero shows the team's crest instead (below).

The installed app's icons (M15 t326) are the team crest (`src/app/assets/team-logo.png`) centred at 66% of the side
on a `#05070a` square (`--bar`): `public/icon-192.png`, `public/icon-512.png` (also the maskable icon: the round crest
sits inside the 80% safe circle) and `public/apple-touch-icon.png` (180px). They were drawn once with PowerShell's
System.Drawing (the command is in `docs/superpowers/plans/2026-10-22-m15-p8.md`, Task 1); redraw them when the crest changes.

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
`--radius-xs` 8px for account menu items, `--radius-pill` for pills and subnav chips. Shadows belong to the pane
system (`--pane-shadow`, `--score-shadow`, see Depth) plus the gold hover glow `--shadow-lift`.

Touch: `--tap` 44px minimum, `--tap-lg` 48px tabs and menu items, `--tap-tally` 76px stat buttons. Motion:
`--dur` 150ms with `--ease`, and `--dur-flash` 400ms for the over-budget flash; `--dur-menu` 200ms for menus and
opened sections dropping in, `--dur-fade` 300ms for loaded content fading in, `--dur-rest` 1.6s for a loading
skeleton's slow breathing, `--dur-count` 600ms for a score counting up to its new value.

Frame: a full-width black top bar, then one column (`--shell` 720px, `--gutter` 16px side padding, 24px top).

**Phones (600px and narrower):** every box floats as a rounded glass pane inside the 16px gutter, the same as on
wider screens and like the scoreboard; cards use 12px padding and the buy-shares columns slim to 4rem / 3.5rem / 44px. Only
the signed-out hero runs edge to edge, merging with the top bar. (Before M9 polish, phone cards were square bands.)

## Words

Player-facing glossary (clarify pass, board t115): a **season** is the league year; a **tournament** is one event
(a stage in code); a **game** is one tournament game and its tally (a session in code). Lists and titles name the
game, "Game 3 · Fall Beta", with the date as small text; only older practice sessions fall back to date · kind.
Buttons say the action and its object ("Save settings", "Change close time", "Reopen tally", "Delete these stats").
Errors say what happened and what to do; an unknown error shows its code only in brackets after that.
**Few small words** (board t231): small grey text only when it prevents a mistake, explains a state, or is required
(the donation terms). Controls and pills speak for themselves. Account-menu items have no subtitles.
**Share**: the part of a player a team owns, shown as a percentage ("You own 66% of Sam"); credits put on a
player buy shares, and a team scores that part of his points. **Buy shares**: the action that was the auction; the
card, the button and the admin controls all say "Buy shares" or "buying". Never "bid" or "auction" in player-facing
text (the code names `bids`, `place_bid`, `run_auction` stay).
**Opponent**: the real team our team plays in a game; players see "vs Duke", staff see "Game 2 vs Duke"; unnamed games stay "Game 2".

## Components

- **Top bar** (`.topbar`): black. Brand on the left, the account avatar on the right, and tabs: League, Stats,
  Leaderboards (the same three for everyone signed in). From 640px the tabs sit in the bar; tabs are muted until hovered, the current tab is white, and
  one 3px gold `.ink` marker glides under it when you switch (`useInk` in `src/app/lib/useInk.ts` measures the
  current tab). **On phones (under 640px) the same tabs dock at the bottom** within thumb reach (M9 t92): a frosted
  `--sticky-bg` bar of equal 48px tabs, the gold marker on its top edge, and the page padded by `--dock-height` so
  nothing hides under it (focused inputs scroll clear of it too). Safari keeps the dock clear of the iPhone home bar
  on its own (checked on a real iPhone, t128), so there is no safe-area padding. Keepers reach the tally from a
  Tally button in the Stats page head and from a Tally button on each open game under "All stats"
  (`/tally?game=<id>` opens that board directly), not from a tab. The dock is hidden while the
  tally board is on screen (`body:has(.tally-bar)`); `tokens.test.ts` guards that. Deep routes light their tab:
  `/stats/*`, `/player/*` and `/tally` light Stats, `/team/*` lights Leaderboards; Me, Credits, Rules and Admin light none.
- **Account menu**: a gold avatar with the user's initial opens a native `popover` with the name and email, *Me*,
  *Credits*, *Rules*, *Admin* (admins), *Install app* (below), *Light mode* / *Dark mode* and *Sign out*. The avatar
  gets a baby blue ring while you're on Me.
- **Install as an app** (M15 P8): *Install app* shows only outside the installed app, when the browser has offered to
  install (Chrome, Edge, Android: it opens the browser's own dialog) or on an iPhone/iPad, where it turns into the hint
  "In Safari, tap Share, then Add to Home Screen." (`.account-hint`). Inside the installed app the sign-in page's "Code
  sent" box adds "Type the code from the email here: its link opens your browser, not this app." (an iPhone gives the
  home-screen app its own storage, so a Safari sign-in doesn't carry over). A service worker (`src/sw.js`, production
  builds only) keeps the app's own files for offline starts; it never touches Supabase. A new deploy reaches an open
  installed app the next time it comes back to the front.
- **`.page`**: a page's outer stack (16px gaps, a little extra space under the heading).
- **`.card`**: a smoked-glass pane (`--pane-*`), hairline border, 14px radius, 16px padding. `details.card` is a collapsible card
  with a drawn chevron.
- **`.section`**: a divided part inside a card: a top rule, not a new box.
- **`.stack`**: a plain vertical group with 12px gaps.
- **`.head` / `.meta` / `.row`**: title-with-actions row, wrapping inline details, and a wrapping form row.
- **Buttons**: gold with dark text by default. `.secondary` is a soft borderless `--surface-2` fill. `.linklike` looks
  like a link. `.button` makes a link look like a button. Buttons in a stack sit at their natural width, left.
- **`.list`**: on the page, each row is its own bordered box (min 56px tall). Inside a `.card`, rows become
  plain rows split by divider lines. `li.used` greys the row's title (a "Used" pill says why).
- **`.actions`**: a row of equal-width buttons that never wraps unevenly. Admin athlete rows (`li.athlete`)
  stack name, account picker and `.actions` on phones and sit on one line from 640px.
- **Bullet lists** directly inside a `.card` (the rules page) have no margin and 8px gaps.
- **Rules page** (`/rules`): the `h1` "How Tribe Fantasy works", the same four steps as the guide, the `.notice` (free to play,
  donations, whose settings the numbers are), then six closed `details.card` folds, each `summary > h2`: The season, Credits and
  shares, Picks, Scoring, Standings points, Questions. Under 120 words show before the folds. Every number is derived from the
  season's settings (the defaults when signed out); the email timings and the 100 / 50-credit example stay literal text.
- **Banners** like "Welcome! Set your name" show only on the League page, never on task screens like Tally.
- **`.pill`**: a rounded label that always carries its own words. Variants: plain (neutral), `.ok`, `.info`,
  `.warn`, `.bad`.
- **`.notice`**: an info pane, the same glass as every box but glowing blue (`--notice-bg`), for information and next steps ("Set your name and join a league").
- **`.success`**: green text with `role="status"` for a confirmed result. **`.error`**: red text with
  `role="alert"` for a failure, saying what to do next. **Loading** is the `Loading` component
  (`src/app/components/Loading.tsx`): a `.skeleton` pane in a card's shape (a title bar and two lines; inside a `.card`
  just the bars, never a box in a box) with
  `role="status"` and a hidden "Loading…" for screen readers (M9 t99). Me and the tally pages still show plain
  `.muted` "Loading…" text.
- **`.segmented`**: a joined group of buttons with `aria-pressed`; the chosen one is inverted (text colour
  as background). Used for the Standings league / All leagues toggle (Leaderboards) and the team switcher.
- **`.subnav`**: admin's sticky row of rounded tabs (`aria-pressed`): on phones one row you swipe sideways; from
  640px the chips wrap onto a second row rather than hide past an edge a mouse can't scroll (t126). Admin shows one section
  at a time; the chosen tab is inverted like `.segmented`, drawn by a dark `.ink` pill that glides between chips (the
  chips are see-through so the pill shows while it moves). Admin opens on the newest season.
- **Admin Users / League browser / History** (M14): Users is one `.card` list with Search people, a role button per
  role, Rename and a red-worded "Remove account" whose confirm names every team, donation and profile it touches.
  The league browser (Leagues → Open) shows each team with its owner and roster; each share is a percent field with Save and an X to remove it,
  and a removed team is read-only. Admin changes never move credits. History is a `.card > ul.list`: one plain-words
  line per audit row ("Gave Sam Grossberg 25% to Gimp Zeal"), actor and time as small text, a filter by action and
  "Load more" for the next 50. Removed people show as "Removed user"; a removed team keeps its name.
- **Admin Games count** (M15 P4): Open tournament has a required "Games" number (1-20); the open Tournament card shows "game n of N" and the same field with "Save count" (not below the highest started game). Raising an over tournament confirms the new game's pairings first; lowering needs no confirm.
- **League tab, matchup first** (`Matchup` in `TournamentCard.tsx`): per team, the game that matters now (live,
  else next, else last played) as a `.display` headline "TEAM vs OPPONENT" (`--fs-matchup`, shrinks on phones; the
  page `h1` is `.sr-only` once you have a team). Each name (`.side`) has its owner's real name under it in small muted
  sans text (`.owner`); no line when the owner has no display name, "Removed user" for a removed account. Under it a `.strip` of facts: tournament, a `.chip` with the dates,
  game number, and the state (a red `.live` dot whose ring pulses, Next up, Waiting on stats, or Won/Lost ±points).
  While a game is live or waiting on stats, a `.pill.warn` "Unofficial" sits beside that state: live numbers are never
  shown without the word. Then a black `.score` scoreboard: both players in the display face before scores exist, `--fs-score` numbers once
  final (the unofficial numbers while the game is live or waiting on stats), the losing side muted; before a game starts their pick reads "Hidden". Once a game has
  started, a `section.card.starters` under the scoreboard lists each side: a `.head` with the team and its score, then one row per starter
  "Name · 1 Goal" with his points. A chip `.since.up` (gold) or `.since.down` (`--error`) "+3" / "−2" shows on a row whose
  points changed since this device last looked, and stays until the next change (the sign carries the meaning, not the colour). A verified
  game shows the same block without the pill. Then `.tiles`: Place "N `.of` M",
  Record, Points, only once any game counts; before that the strip says "N teams · No games yet". Then the "Next
  game" card (the pick), the Buy shares card (while buying is open; between close and settling it is the single notice
  "Buying closed for <tournament>. Your players show here once the shares are settled."; after settling the pick card lists the
  roster), the games, the Join / Create `.more`
  links, and last a muted `details.settings` "League settings" fold. It always renders for your team and opens
  with Rename team first (`rename_my_team`: 1–40 characters, unique in the league), then Manage league and Leave.
- **First-visit guide** (`Guide`, `aside.notice.guide`): above everything else on League, an `h2` "How it works", the four steps
  (`GuideSteps`, `ol.guide-steps`: Get a team, Buy shares, Pick N each game, Higher score wins) and a row with a "Got it" button and an
  "All the rules" `.more` link to `/rules`. Shown once per account and device: "Got it" stores `tribe.guide.<uid>` = `1`, and the
  guide stays hidden after that; existing players see it once too. Blocked storage (private mode) shows it every visit and "Got it"
  hides it for this visit only, with no error. The Rules page always opens with the same steps, so there is no "show again". The pick
  count comes from the season's settings.
- **Team switcher** (`.segmented.team-switch`): with 2+ teams this season, one team at a time; each button is named by
  its **league** (the team name is the headline below). The choice is remembered on the device and shared with the
  Credits page. Long rows scroll sideways rather than squeeze. Only the current season's teams are listed (all of them
  if none are this season's, t240). A gold `.needs` dot marks a team that needs you: fewer picks than a game takes (2, or your whole roster if smaller)
  for its next game, or open share buying you haven't bought in. When a dotted league is scrolled out of sight, that edge of the switch glows gold and
  pulses (`.team-switch-wrap.glow-left` / `.glow-right`; steady with reduced motion).
  When the chosen team doesn't need you and every dotted league is scrolled out of sight, the first one scrolls into view once the dots load (once, never on scroll); the glow stays.
  A mouse wheel over the switch scrolls it sideways; at either end the page scrolls.
- **Game cards** (`.games` / `details.game`, M9 t93): each played game is a small black `.game-score` scoreboard of
  your matchup (both teams, scores once final, the loser muted; "Bye" or "Not playing" otherwise) with the caption
  **below** it, not inside: "Game 2 · Fall Beta", the status pill, your W/L ±points. One column on phones, two from
  640px; an opened game takes the full row and shows every matchup in a `.card`. With a mouse, the scoreboard lifts
  4px and grows 2% on hover (t97). A game waiting on stats shows the unofficial scores (no W/L, no ±points) with a
  `.pill.warn` "Unofficial" beside "Waiting on stats"; opened, it lists the stat lines and points under the hint
  "Unofficial until a keeper verifies."
- **By-line** (`.by`, t90): a 22px `.avatar.sm` with the team's initial and the team name, heading a side inside an
  opened game; its starters are listed under it (M13, 2v2).
- **League tiles** are the season standing: Place ("N of M"), Record, Points. Credits are not a tile: while
  buying they're "credits left" in the Buy shares header, which reads "N of 6 players" with a `.pill.info` Closes
  pill and a "Get more credits" link to the Credits page. Once credits left drop
  under 10% of the balance (or 2 minimum buys) that link becomes a gold button (t234). The list puts players you'd
  bought when the page loaded first; the order stays put while you buy (t237). A player row has the credits input
  and Buy / Save; at 6 players the other rows lock. "Buy shares" (`details.bid-cta`) reads as a full-width button:
  solid gold before your first buy (`.loud`), gold-outlined after. Open, it's a plain fold header. Above the rows a `.hint`
  "Points a game at <tournament>, the last tournament. Tap a name for game by game." (the last tournament = the most recent
  other tournament with a final game; no such tournament, no line and the names stay plain); each name links to
  `/player/<id>?t=<stage>` and, under it, a small "N a game" (that tournament's average, a game without his line counting 0;
  nothing for a player with no lines, never "0").
- **`?` help** (`Help.tsx`, `.help`): a 44px target around a 22px `--surface-2` circle, opening `.help-pop`, a native `popover`
  with the notice's raised shadow (the browser centres it in the top layer; Esc or a tap outside closes it; nothing positions it, so it never overflows at 375px).
  Three texts, every number from the season's settings: **shares** (shares, credits, the repeat chip) in the Buy shares head;
  **the × factor** (share × tired × earlier tournaments, with the tiredness list and the floor) in the pick card head and beside
  the next-game line on the team page; **unofficial and verified** (who taps, who verifies, the lock hours) beside the League
  "Unofficial" pill, at the end of the Stats live strip, and as the first child of the Stats "All stats" fold (a button can't sit
  in a `summary`). Credits page and game cards have none.
- **Pick card** (M13, `PickGame`): "Pick 2" (with a `?` in its head) with a `.count-line` "N of 2", then every roster player as a `.pickrow`:
  the name (an Out `.pill.bad` if a keeper marked him out for the next game), a **factor chip** (`details.factor`, `Factor`) reading the combined
  factor for the next game ("×0.45", share × tired × earlier tournaments, computed by the core, never the UI) and, one
  tap away, its parts ("66% share · ×0.75 tired · ×0.9 earlier tournaments"; a rested player shows "×1 rested").
  Pick / Your pick (green `.picked`, with "· Clear") fills one of the 2 slots; with both full the other Pick
  buttons are off and a `.hint` says to clear one. An Out player's Pick is off too (a saved pick of his keeps "Your pick · Clear"). A `.notice` names any starter who isn't your own pick (missed or
  out: "X was out, so Y played."). There is no Tired pill and no bench.
- **Score breakdown** (opened game, `SideDetail`): the side total, then one line per starter, "name · stats" and a
  `.calc` "game score × factor = points" ("10 × 0.45 = 4.5"); the side score is the sum. A forfeit side (no players)
  says "Forfeit". The scoreboard holds two names a side.
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
- **Team page** (`TeamPage`, `/team/:membershipId`): the team name as the heading with "Leaderboards" back link, the owner
  and league ("Neal Zeng · League A") under it, the next game as on the pick card ("vs Duke · Fall beta"), then its
  players A→Z, each with the `Factor` chip (total multiplier for that game, the × popover shows the parts). No picks,
  credits or prices. No next game: "No tournament on. Players show once the next tournament's shares are settled."
  No roster: "No players this tournament." A removed team reads "(removed)" and "No players." Only that league's
  members (current season) and staff can open it; anyone else, an unknown id or a malformed one sees "You can only see
  teams in your league." with a Leaderboards link.
- **Team links**: a team name links to its page from Leaderboards standings rows (in All leagues only your own league's
  rows), past-tournament rows, both names in the League matchup headline and "You play X" on the pick card. Not game
  cards. Links inherit the text colour and underline on hover and focus.
- **Standings** (`.ranks`, on Leaderboards): a ranked list. Rank and points in the display face, the rank muted and yours in
  `--gold-text`; the team with its owner's real name and record under it ("Neal Zeng · 2–1"; "League · Neal Zeng · 2–1" in All leagues). A `.segmented` [league]
  [All leagues] toggle shows only when the season has 2+ leagues. Before a verified game this league was paired in (a bye counts) the card shows only "Standings start after the first game." (no rows, no
  toggle); this overturns t239, "a leaderboard from day one", per the M15 spec (§5.7). A long list keeps the top 5, everyone tied with 5th and your row,
  and only cuts when that hides 4+ teams; the gap row says "N more teams" to screen readers. Ties list by team name.
- **`.steps`**: a real sequence as numbered inline steps (admin Tournaments: grant, open, run, open tournament).
- **Fold the rare forms**: forms used once a season (add a tournament, new league, adjust credits) live in a
  collapsed `details.section`; Edit opens the tournament form.
- **`.more`**: a secondary way on, an underlined text link with a drawn chevron that nudges right on hover.
- **`.hero`**: only on the signed-out home page, the one page that has to sell. Black panel, 40px headline,
  gold call to action, and the team crest ("A Tribe Called Tech", white + gold version for dark, `team-logo.png`, t131)
  whole in a second grid column beside the tagline and buttons; on a phone, smaller, beside the tagline only (t132). On top, `.hero-photo` (t94): the team photo with family, friends and
  alumni, cropped to the people (`src/app/assets/team-800.jpg` / `team-1600.jpg`, srcset), bleeding to the panel's
  edges with its sky and grass masked into the dark, and a one-line thank-you caption under it.
- **Tables** (`.table-wrap`): 14px tabular figures, right-aligned numbers, first column left, divider rows.
- **Stat table** (`.stat-table`, `StatTable.tsx`; Stats and the player page): headers are `.linklike` sort buttons with
  `aria-sort` and an arrow (points high-first by default, Player A to Z, a second tap flips); they keep their look on
  hover and press. The table scrolls sideways inside `.table-wrap` while the player column stays put (sticky), so that
  column needs an opaque fill: `--bg` on the page, `--card-solid` (the card glass flattened, in `tokens.css`) inside a `.card`.
  "All stats" is a `details` fold under it listing the tournament's games, each opening its game page; it opens by itself
  for keepers while a game is open. While a game is started and unverified, a `p.strip` above the table reads the
  `.live` dot, "Live" and "Unofficial: includes game 2" ("games 3 and 4", "games 2, 3 and 4"), and the table totals
  include that game's live lines.
- **Stats outside a league**: a signed-in account that can't read league data (no league, or athlete-only; checked with
  `can_read_league_data()`) sees the `h1` and "Join a league to see stats." with a "Join a league" button to `/leagues`: no
  switcher, table, live strip or All stats. While the check is unknown the page is loading; if the check fails the usual page shows.
- **Live refresh**: the League tab (while any of the league's games is live or waiting on stats and has pairings) and Stats (while a shown
  game is started and unverified) reload every 15 s while the tab is visible, at once when it becomes visible again, and
  keep the old numbers on screen until the new ones arrive. Nothing else polls.

## Tally board

- A sticky `.tally-bar` holds the back link, the session name and the sync pill (Saved / Saving / Offline, in
  words). There is no undo button: holding a stat button (~500 ms) takes one of your own taps off, with a
  buzz and an inverted flash (`.minus`) so it never reads as a tap. Minus, Delete or Backspace does the same
  from the keyboard.
- Each player is a `.tally-card`. Stat buttons are big neutral tiles (at least 76px tall, 56px wide) with the
  label on top, the count large in the middle and the points small below. They are not gold; gold is only the press flash.
- Negative stats use a dashed border so the difference is not colour alone.
- Tally buttons never animate. A tap must show instantly, even when other buttons fade.
- The board is bright by default for daylight (see Colour). A "Dark board" / "Bright board" button in the tally bar's
  status row switches it at once, with nothing fading, and the phone remembers the choice (`tribe.tally.bright`). The
  `/tally` games list keeps the app's own theme.
- The Out control sits apart in the card header, never among the stat tiles: "Mark out", or an "Out" `.pill.bad` ("Out from game N" until game N starts) with "Clear out". It is hidden on a closed (verified or earlier-season) board. Nobody marks their own attendance or injury any more; keepers mark Out (M15 P5).
- The `/tally` games list opens with a "Players out" card for marking before a tournament: "Out · <stage>", rows "name · from game N" with Clear, "Nobody is out." when empty, then a Player select and "Mark out". No confirms: Mark out and Clear undo each other.
- The tally's game card ends with the opponents list (t313): one row per game, "Game k" with its name field and Save, for every game started or not, any time. Finishing the last game asks first ("It's the last game: <stage> ends."); an over tournament says so with no button.

## Rules

- **No box inside a box.** Inside a card, use `.section` rules and divided `.list` rows, never another bordered box.
- **44px targets.** Every button, input, link-only line, summary and checkbox row is at least 44px tall.
- **Colour is never the only signal.** Pills carry words, negative tallies are dashed, the current tab is
  underlined, errors are written out.
- **Gold means act.** Use gold for the main action and the current place, not for decoration or long text.
- **Text on gold is always `--on-gold`.** Links and focus are baby blue (`--link`).
- **Depth**: floating panes (cards, number tiles, the scoreboard, the account menu, sticky buy-shares header and admin
  subnav) are frosted glass: `--pane-bg` layered fill, `--pane-highlight` top edge, `--pane-shadow`, `--pane-blur`, over
  a faint gold and blue `--bg-ambient` glow on the page; each pane has a gold glow in its top-left corner, like the
  scoreboard. Page-level list rows get the same fill and shadow without the blur. Rows inside panes
  and the tally board never blur (phone GPU).
- **Button lettering** (user's pick, board t112): Archivo bold at a narrow 78% width, all caps, 0.06em tracking,
  14px (`--font-button`, `--fw-button`, `--fs-button`, `--button-stretch`, `--button-case`, `--button-track`), like a
  jersey label. Text links, account-menu items and the whole tally card keep their own lettering.
- **Disabled buttons** are a quiet `--surface-2` fill with `--muted` text, not faded gold; a pick mid-save stays green.
- **Buttons are flat and crisp** (user's pick over keycap, push-key, glow and metal styles, board t111): plain fills,
  no border or bevel. Hover lifts 1px and gold buttons glow (`--shadow-lift`); press squeezes to 95% and springs back
  (`--dur-release`, `--ease-spring`). Chips and segmented buttons don't move. A chosen pick is green (`.picked`) with a
  drawn check and a one-time pop.
- **Motion is small and physical**, and only when the user has not asked for reduced motion: 150ms colour fades
  (`--dur`), every button squeezes to 95% while pressed (`--dur-press`), gold buttons rise 1px with a gold
  `--shadow-lift` on hover, and tab markers glide (`--dur-slide`, `--ease-glide`). The account menu and every opened
  `details` drop 8px in and fade (`--dur-menu`; closing is instant), page content fades in as it arrives
  (`--dur-fade`), and loading skeletons breathe (`--dur-rest`). On the League matchup the scoreboard numbers count up to a new
  value (`--dur-count`; the starters' team scores stay plain) and a "since you last looked" chip pops in; with reduced motion
  both just appear. The tally board never moves: no transitions, no press
  scale, no lift, no fade-in (`tokens.test.ts` guards the fade).
- **Focus is always visible**: a 3px ring in `--focus`, offset 2px.
