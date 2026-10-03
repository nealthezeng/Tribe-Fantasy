# M9: UI/UX redesign (decision record)

Status: built on branch `m9-ui` (off main `adfb252`), not merged. Board phase p13, tasks t85–t117.
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

## Open backlog (board, todo)

t90 "athlete by manager" lines · t92 phone bottom tab bar (biggest, touches every screen) · t93 game cards with
caption below · t94 team photo hero (needs a photo everyone in it OKs) · t96 live score ticker · t97 card lift ·
t98 menu slide-in · t99 load skeletons · t100 traced border (pick one of t95/t100 for "live"; t95 pulse is built).
Also: sliding thumb for the attendance toggle.

## Risks and checks before / after merge

- **Dark tally in sunlight**: keepers use it outdoors. Try it on a phone in daylight before Nov 7; fallback is a
  light theme for the tally screen only.
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
