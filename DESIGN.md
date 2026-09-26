# Tribe Fantasy design system

What the shipped UI looks like, recorded from `src/app/styles.css`, `src/app/components/Layout.tsx` and
`src/app/pages/`. How a page should behave (one job per screen, plain words, show state, the checklist) lives
in [docs/frontend-principles.md](docs/frontend-principles.md). Who it is for lives in [PRODUCT.md](PRODUCT.md).
All tokens and classes are in `src/app/styles.css`. Reuse them before adding new ones. No UI libraries.

## Colour

The team's two colours are fixed by the user. Black and white carry everything else.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--gold` | #f5b700 | same | Actions: primary buttons, current tab underline, text selection, checkboxes, the disc |
| `--gold-hover` / `--gold-press` | #ffc629 / #dba300 | same | Button hover and press |
| `--on-gold` | #111111 | same | Text on gold. Never white. |
| `--blue` | #8cc8f2 | same | Info and selection: `.subnav` hover border, the disc centre |
| `--blue-soft` / `--blue-ink` | #e3f1fc / #0b4a75 | #16304a / #bfe1fa | `.notice` and `.pill.info` background and text |
| `--link`, `--focus` | #0b5d99 | #8cc8f2 | Links and the 3px focus ring |

Neither team colour is readable as text on white, so light mode uses the deep blue `#0b5d99` for links and focus.
In dark mode the baby blue itself is readable and takes over.

Neutrals:

| Token | Light | Dark | Role |
|---|---|---|---|
| `--bg` | #f4f7fa | #0b0f14 | Page background |
| `--surface` | #ffffff | #141a21 | Cards, inputs, list rows, secondary buttons |
| `--surface-2` | #eef3f8 | #1b232c | Tally buttons, neutral pill, secondary hover |
| `--fg` | #0f1419 | #e8edf2 | Text |
| `--muted` | #56606b | #9aa6b2 | Secondary text, table headers, placeholders |
| `--line` | #dbe2ea | #26303b | Card borders and dividers |
| `--line-strong` | #8795a3 | #66737f | Input, secondary button and segmented borders |
| `--bar` / `--bar-fg` / `--bar-muted` | #0f1419 / #fff / #b4bfca | #05070a / #fff / #9aa6b2 | Top bar and hero |

Status, each with a soft background for pills:

| Token | Light | Dark | Used by |
|---|---|---|---|
| `--ok` / `--ok-soft` | #1d6b35 / #dcf1e2 | #7fd69a / #16301f | `.success`, `.pill.ok` |
| `--warn` / `--warn-soft` | #8a4b00 / #fdebd0 | #f4b566 / #3a2a13 | `.pill.warn` |
| `--error` / `--error-soft` | #b3261e / #fbe3e0 | #ff8a80 / #3b1a18 | `.error`, `.pill.bad` |

Dark mode follows `prefers-color-scheme` only. There is no toggle.

## Brand mark

`DiscMark` in `Layout.tsx`: a disc seen from above. Gold circle, darker gold ring (#c99400), baby blue centre.
The same drawing is the favicon in `index.html`; change both together. It sits at 24px beside "Tribe Fantasy"
in the black top bar, and at 168px, cropped off the corner, behind the signed-out hero.

## Type

One family: `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`. Monospace (`ui-monospace, 'Cascadia Mono',
Consolas`) only for `code`, the settings textarea and `.code` (invite codes, 18px, spaced out).

| Token | Size | Use |
|---|---|---|
| `--fs-sm` | 14px | Labels, `small`, tables, subnav |
| `--fs-md` | 16px | Body, `h3` |
| `--fs-lg` | 20px | `h2` |
| `--fs-xl` | 26px | `h1` (weight 750, slightly tight tracking) |
| `--fs-num` | 32px | `.big` headline numbers (tabular) |

Body line height 1.5, headings 1.2 and balanced. Numbers that line up use `.num` or tabular figures.
Small fixed sizes exist only inside their component: pills and table headers 13px, brand 17px, tally counts 24px,
tally labels 12px and weights 11px, hero headline 40px and hero text 18px.

## Space and shape

Spacing: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 24, `--s6` 32 (px). Layouts stack with grid `gap`, not margins.

Radii: `--radius` 14px for cards and the hero, `--radius-sm` 10px for buttons, inputs, list rows and notices,
999px for pills and subnav chips. No shadows anywhere.

Frame: a full-width black top bar, then one 720px column (`.shell`, 16px side padding, 24px top).

## Components

- **Top bar** (`.topbar`): black, brand on the left, nav on the right. Nav links are muted until hovered; the
  current tab is white with a 3px gold underline. On narrow phones a nav of three or more items wraps to its own
  full-width row.
- **`.page`**: a page's outer stack (16px gaps, a little extra space under the heading).
- **`.card`**: white surface, 1px line border, 14px radius, 16px padding. `details.card` is a collapsible card
  with a drawn chevron.
- **`.section`**: a divided part inside a card: a top rule, not a new box.
- **`.stack`**: a plain vertical group with 12px gaps.
- **`.head` / `.meta` / `.row`**: title-with-actions row, wrapping inline details, and a wrapping form row.
- **Buttons**: gold with dark text by default. `.secondary` is white with a strong border. `.linklike` looks
  like a link. `.button` makes a link look like a button. Buttons in a stack sit at their natural width, left.
- **`.list`**: on the page, each row is its own bordered box (min 56px tall). Inside a `.card`, rows become
  plain rows split by divider lines.
- **`.pill`**: a rounded label that always carries its own words. Variants: plain (neutral), `.ok`, `.info`,
  `.warn`, `.bad`.
- **`.notice`**: a soft blue box for information and next steps ("Set your name and join a league").
- **`.success`**: green text with `role="status"` for a confirmed result. **`.error`**: red text with
  `role="alert"` for a failure, saying what to do next. Loading is `.muted` text with `role="status"`.
- **`.segmented`**: a joined group of buttons with `aria-pressed`; the chosen one is inverted (text colour
  as background). Used for attendance.
- **`.subnav`**: a sticky, sideways-scrolling strip of rounded chips that jump to `[data-section]` blocks on
  the long admin page. Hover turns them soft blue.
- **`.hero`**: only on the signed-out home page, the one page that has to sell. Black panel, 40px headline,
  gold call to action, the large disc behind.
- **Tables** (`.table-wrap`): 14px tabular figures, right-aligned numbers, first column left, divider rows.

## Tally board

- A sticky `.tally-bar` holds the back link, the session name, the sync pill (Saved / Saving / Offline, in
  words) and "Undo last tap".
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
- **Gold and baby blue are never text colours on white.** Text on gold is `--on-gold`; light-mode links use `--link`.
- **Motion is 150ms colour fades only**, and only when the user has not asked for reduced motion.
- **Focus is always visible**: a 3px ring in `--focus`, offset 2px.
