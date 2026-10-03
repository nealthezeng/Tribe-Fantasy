# Tribe Fantasy design system

What the shipped UI looks like, recorded from `src/app/styles.css`, `src/app/components/Layout.tsx` and
`src/app/pages/`. How a page should behave (one job per screen, plain words, show state, the checklist) lives
in [docs/frontend-principles.md](docs/frontend-principles.md). Who it is for lives in [PRODUCT.md](PRODUCT.md).
**To change the look, edit `src/app/tokens.css`**: every colour, font, size, radius, shadow and
duration lives there. `src/app/styles.css` imports it and only reads the tokens. The favicon and `theme-color` in
`index.html` can't read CSS, so they repeat gold, baby blue and the bar colour by hand. Reuse the classes in
`styles.css` before adding new ones. No UI libraries.

## Colour

**Always dark** (M9, the user's choice): the whole site lives in the scoreboard's world of smoked glass, a faint gold
and blue glow, and white type. There is no light theme and no toggle; `color-scheme: dark` is set in `tokens.css`
and `index.html`. The team's two colours are fixed by the user: gold and baby blue.

| Token | Value | Role |
|---|---|---|
| `--gold` | #f5b700 | Actions: primary buttons, current tab underline, text selection, checkboxes, the disc, the avatar |
| `--gold-deep` | #c99400 | The ring in the disc mark |
| `--gold-hover` / `--gold-press` | #ffc629 / #dba300 | Button hover and press |
| `--on-gold` | #111111 | Text on gold. Never white. |
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
in the black top bar, and at 168px, cropped off the corner, behind the signed-out hero.

## Type

Two faces, both from Google Fonts in `index.html` (`display=swap`):

- **Big Shoulders Display** 800, uppercase (`--font-display`, `--fw-display`, `--display-case`, `--display-track`):
  the loud voice. Tall and tight like a scoreboard. Only for `h1` page titles, the brand, the signed-out hero and
  `.big` numbers; never below about 22px and never for running text. `h1 small` drops back to Archivo. Chosen by
  the user in M9 from six pairings (board t101).
- **Archivo** for everything else: a grotesque made for sports and news graphics, with even figures for stats
  (variable, weights 400–700, widths 87.5–100%, system-ui fallback).

Font tokens: `--font-sans` (Archivo stack), `--font-heading` (points at `--font-sans`) with `--heading-stretch`
92% so headings and the brand use a slightly condensed cut, and `--font-mono` only for `code`, the settings
textarea and `.code` (invite codes). Weights come from four tokens: `--fw-regular` 400 (body), `--fw-medium` 500,
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
| `--fs-xl` | 26px | Spare step |
| `--fs-num` | 40px | `.big` headline numbers (display, tabular) |
| `--fs-display` | 40px | `h1` page titles (display) |
| `--fs-hero` | 64px | The signed-out hero headline (display) |

Body line height 1.5, headings 1.2 and balanced. Numbers that line up use `.num` or tabular figures.
Smaller steps for single components are tokens too: `--fs-3xs` 11px (tally weights), `--fs-2xs` 12px (tally
labels), `--fs-lead` 18px (brand, hero text, invite codes, tally player names), `--fs-count` 24px (tally counts).
`src/app/tokens.test.ts` fails if `styles.css` gains a colour, font size, font family, radius or duration literal.

## Space and shape

Spacing: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32 (px). Layouts stack with grid `gap`, not margins.

Radii: `--radius` 14px for cards and the hero, `--radius-sm` 10px for buttons, inputs, list rows and notices,
`--radius-xs` 8px for account menu items, `--radius-pill` for pills and subnav chips. One shadow, `--shadow-pop`,
only on the floating account menu.

Touch: `--tap` 44px minimum, `--tap-lg` 48px tabs and menu items, `--tap-tally` 76px stat buttons. Motion:
`--dur` 150ms with `--ease`, and `--dur-flash` 400ms for the over-budget flash.

Frame: a full-width black top bar, then one column (`--shell` 720px, `--gutter` 16px side padding, 24px top).

**Phones (600px and narrower):** cards, the hero and page-level list rows run edge to edge as full-width bands
(no side borders, no radius), like a native settings screen. Rounded floating cards are for wider screens only.

## Components

- **Top bar** (`.topbar`): black. Brand on the left, the account avatar on the right, and tabs: League, Stats,
  Tally (keepers), Admin (admins). On phones the tabs are a second full-width row of equal tabs; from 640px it's
  one row. Tabs are muted until hovered; the current tab is white, and one 3px gold `.ink` marker glides under it
  when you switch (`useInk` in `src/app/lib/useInk.ts` measures the current tab).
- **Account menu**: a gold avatar with the user's initial opens a native `popover` with the name and email, *Me*
  and *Sign out*. The avatar gets a baby blue ring while you're on Me.
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
- **Banners** like "Welcome! Set your name" show only on the League page, never on task screens like Tally.
- **`.pill`**: a rounded label that always carries its own words. Variants: plain (neutral), `.ok`, `.info`,
  `.warn`, `.bad`.
- **`.notice`**: a soft blue box for information and next steps ("Set your name and join a league").
- **`.success`**: green text with `role="status"` for a confirmed result. **`.error`**: red text with
  `role="alert"` for a failure, saying what to do next. Loading is `.muted` text with `role="status"`.
- **`.segmented`**: a joined group of buttons with `aria-pressed`; the chosen one is inverted (text colour
  as background). Used for attendance.
- **`.subnav`**: admin's sticky, sideways-scrolling row of rounded tabs (`aria-pressed`). Admin shows one section
  at a time; the chosen tab is inverted like `.segmented`, drawn by a dark `.ink` pill that glides between chips (the
  chips are see-through so the pill shows while it moves). Admin opens on the newest season.
- **League tab, matchup first** (`Matchup` in `TournamentCard.tsx`): per team, the game that matters now (live,
  else next, else last played) as a `.display` headline "TEAM vs OPPONENT" (`--fs-matchup`, shrinks on phones; the
  page `h1` is `.sr-only` once you have a team). Under it a `.strip` of facts: tournament, a `.chip` with the dates,
  game number, and the state (a red `.live` dot whose ring pulses, Next up, Waiting on stats, or Won/Lost ±points).
  Then a black `.score` scoreboard: both players in the display face before scores exist, `--fs-score` numbers once
  final, the losing side muted; before a game starts their pick reads "Hidden". Then `.tiles`: Credits, Place
  "N `.of` M", Record. Then the auction, then the Tournament card (pick, standings, games).
- **`.more`**: a secondary way on, an underlined text link with a drawn chevron that nudges right on hover.
- **`.hero`**: only on the signed-out home page, the one page that has to sell. Black panel, 40px headline,
  gold call to action, the large disc behind.
- **Tables** (`.table-wrap`): 14px tabular figures, right-aligned numbers, first column left, divider rows.

## Tally board

- A sticky `.tally-bar` holds the back link, the session name and the sync pill (Saved / Saving / Offline, in
  words). There is no undo button: holding a stat button (~500 ms) takes one of your own taps off, with a
  buzz and an inverted flash (`.minus`) so it never reads as a tap. Minus, Delete or Backspace does the same
  from the keyboard.
- Each player is a `.tally-card`. Stat buttons are big neutral tiles (at least 76px tall, 56px wide) with the
  label on top, the count large in the middle and the points small below. They are not gold; gold is only the press flash.
- Negative stats use a dashed border so the difference is not colour alone.
- Tally buttons never animate. A tap must show instantly, even when other buttons fade.
- Attendance and injury controls sit apart in the card header, never among the stat tiles.

## Rules

- **No box inside a box.** Inside a card, use `.section` rules and divided `.list` rows, never another bordered box.
- **44px targets.** Every button, input, link-only line, summary and checkbox row is at least 44px tall.
- **Colour is never the only signal.** Pills carry words, negative tallies are dashed, the current tab is
  underlined, errors are written out.
- **Gold means act.** Use gold for the main action and the current place, not for decoration or long text.
- **Text on gold is always `--on-gold`.** Links and focus are baby blue (`--link`).
- **Depth**: floating panes (cards, number tiles, the scoreboard, the account menu, sticky bid header and admin
  subnav) are frosted glass: `--pane-bg` layered fill, `--pane-highlight` top edge, `--pane-shadow`, `--pane-blur`, over
  a faint gold and blue `--bg-ambient` glow on the page; each pane has a gold glow in its top-left corner, like the
  scoreboard. Page-level list rows get the same fill and shadow without the blur. Rows inside panes
  and the tally board never blur (phone GPU).
- **Buttons are flat and crisp** (user's pick over keycap, push-key, glow and metal styles, board t111): plain fills,
  no border or bevel. Hover lifts 1px and gold buttons glow (`--shadow-lift`); press squeezes to 95% and springs back
  (`--dur-release`, `--ease-spring`). Chips and segmented buttons don't move. A chosen pick is green (`.picked`) with a
  drawn check and a one-time pop.
- **Motion is small and physical**, and only when the user has not asked for reduced motion: 150ms colour fades
  (`--dur`), every button squeezes to 95% while pressed (`--dur-press`), gold buttons rise 1px with a gold
  `--shadow-lift` on hover, and tab markers glide (`--dur-slide`, `--ease-glide`). The tally board never moves:
  no transitions, no press scale, no lift.
- **Focus is always visible**: a 3px ring in `--focus`, offset 2px.
