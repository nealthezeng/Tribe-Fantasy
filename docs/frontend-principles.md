# Front-end principles

A clean, simple look, not a professional product. Most use is on phones, often at practice.

## What makes a page good

- **One job per screen.** The main action is obvious and sits first. Everything else is quieter or tucked away.
- **Plain words.** Label things by what they do ("Grant allowance", "Undo last tap"), not by how they work.
  Players see stages as "seasons".
- **Always show state.** Something is loading, saved, unsaved, offline, or failed, and the page says which.
  Errors say what to do next.
- **Consistent.** The same spacing, colours, buttons and cards everywhere. Reuse the tokens and classes in
  `src/app/styles.css` (`--accent`, `.card`, `.list`, `.notice`, `.muted`) before adding new ones.
- **Easy to read.** One font, a few sizes, generous whitespace, and a line length that stays readable
  (`.shell` is 720px wide).
- **Works on a phone first.** One column at 375px wide, no sideways scrolling, and tap targets at least 44px.
- **Accessible basics.** Every input has a label. Text contrast is at least 4.5:1 in both light and dark mode.
  Colour is never the only signal. Everything works with the keyboard.
- **Fast and quiet.** No spinners without a reason, no animation for its own sake, no new libraries for
  what CSS can do.

## By audience

Pages live in `src/app/pages/` with hash routes. Shared layout is `src/app/components/Layout.tsx`, and all
styles are in `src/app/styles.css`.

**Players:** `#/` HomePage, `#/join` JoinPage, `#/login` LoginPage, `#/stats` StatsPage, `#/stats/:id`
SessionPage, `#/me` MePage
- Answer "how is my team doing?" at a glance: team, balance, this week's matchup. Details go one tap deeper.
- Friendly empty states ("You're not in a league yet. Join with an invite code.").

**Stat keepers:** `#/tally` TallyPage
- Big buttons, readable in sunlight, usable one-handed. No mis-taps between neighbouring buttons.
- Sync status always visible ("Saved ✓" / "3 unsaved"), and undo is always one tap away.
- Nothing on the tally screen that doesn't help tally.

**Admin console:** `#/admin` AdminPage and its panels in `pages/admin/`
- Group by task (season → stages, leagues, wallets, athletes), with the most-used panels first.
- Confirm results after every action ("credited 6 teams"). Destructive or money-related actions state what
  will happen before they happen.
- Dense is fine here, cluttered isn't: tables or lists over walls of cards.

## Checklist for any page change

- [ ] Main action obvious within 3 seconds
- [ ] Loading, empty, error and success states all handled
- [ ] Looks right at 375px and 1280px, in light and dark mode
- [ ] Labels on inputs, and keyboard reachable
- [ ] Uses the existing tokens and classes; no new dependency
