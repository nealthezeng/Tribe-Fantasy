# Front-end principles

A clean, simple look, not a professional product. Most use is on phones, often at practice.

## What makes a page good

- **One job per screen.** The main action is obvious and sits first. Everything else is quieter or tucked away.
- **Plain words.** Label things by what they do ("Grant allowance", "Undo last tap"), not by how they work.
  Everyone sees stages as "tournaments"; the league year is the "season".
- **Always show state.** Something is loading, saved, unsaved, offline, or failed, and the page says which.
  Errors say what to do next.
- **Consistent.** The same spacing, colours, buttons and cards everywhere. Reuse the tokens and classes in
  `src/app/styles.css` (`.card`, `.list`, `.pill`, `.notice`, `.muted`) before adding new ones. Colours, fonts and
  sizes live only in `src/app/tokens.css`. `DESIGN.md` at the repo root records the whole system.
- **Easy to read.** Archivo for reading, Big Shoulders only for the loud bits (titles, scores), a few sizes, generous whitespace, and a line length that stays readable
  (`.shell` is 720px wide).
- **Works on a phone first.** One column at 375px wide, no sideways scrolling, and tap targets at least 44px.
- **Accessible basics.** Every input has a label. Text contrast is at least 4.5:1 (the site is always dark since M9).
  Colour is never the only signal. Everything works with the keyboard.
- **Fast and quiet.** No spinners without a reason, no new libraries for
  what CSS can do.
- **Small, physical motion.** Colour fades, the gliding tab marker, a button's lift and squeeze, the Live pulse. All of it
  off with reduced motion; see DESIGN.md. Nothing decorative.

## By audience

Pages live in `src/app/pages/` with hash routes. Shared layout is `src/app/components/Layout.tsx`, tokens are in
`src/app/tokens.css` and component styles in `src/app/styles.css`.

**Players:** `#/` HomePage, `#/join` JoinPage, `#/login` LoginPage, `#/stats` StatsPage, `#/stats/:id`
SessionPage, `#/me` MePage
- Answer "how is my team doing?" at a glance: team, balance, this tournament's matchup. Details go one tap deeper.
- Friendly empty states ("You're not in a league yet. Join with an invite code.").

**Stat keepers:** `#/tally` TallyPage
- Big buttons, readable in sunlight, usable one-handed. No mis-taps between neighbouring buttons.
- Sync status always visible ("Saved ✓" / "3 unsaved"); holding a stat button takes one of your taps off.
- No motion, press effects or glass on the tally board: a tap must show instantly.
- Nothing on the tally screen that doesn't help tally.

**Admin console:** `#/admin` AdminPage and its panels in `pages/admin/`
- Group by task (season → stages, leagues, wallets, athletes), with the most-used panels first.
- Confirm results after every action ("credited 6 teams"). Destructive or money-related actions state what
  will happen before they happen.
- Dense is fine here, cluttered isn't: tables or lists over walls of cards.

## Checklist for any page change

- [ ] Main action obvious within 3 seconds
- [ ] Loading, empty, error and success states all handled
- [ ] Looks right at 375px, 768px and 1280px (always dark)
- [ ] Labels on inputs, and keyboard reachable
- [ ] Uses the existing tokens and classes; no new dependency
- [ ] Team colours only in their roles: gold for actions, baby blue for info and selection, never either as text on white
- [ ] Tap targets at least 44px, including text links and small chips
