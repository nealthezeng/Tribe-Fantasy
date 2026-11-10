# UI refresh: four rooms, marks instead of sentences (2026-11-10)

Decision record for branch `refresh-rooms`. Front end only: no migration, no RPC, no setting.

## Why

The user asked for a UI/UX refresh with one hard rule: no short text blurbs explaining the app. A player should work
the screen out from what it shows. The League tab had nine explaining texts above the first thing you could tap (the
"How it works" card, two hint paragraphs, a table caption, a caption on every number) and stacked the matchup, the
pick, 23 buy rows, the table and the games in one scroll.

## What the user chose

Three directions were shown as phone mockups (https://claude.ai/artifact/64Q6hVevjWghcg3qK5SUMU): A "Signals" (same
layout, marks for sentences), B "Four rooms" (A's marks inside four sub-tabs), C "One card" (flat, one hero card).
**The user picked B.** Team colors, fonts and the smoked-glass panes stay.

## What was built

- **Rooms.** A team on the League tab is the matchup headline, a three-step track, then four rooms, one on screen at a
  time: **Now** (scoreboard, starters, the next pick), **Roster** (share buying while it is open; the players owned),
  **Table** (the whole league, "All leagues" opens Leaderboards), **Games**. Rooms stay mounted and are hidden with the
  `hidden` attribute, so a half-typed buy survives a look at the table. A gold dot marks a room that needs you. Until a
  room is tapped the tab opens on the one with something to do.
- **Track.** Buy, Pick, Play. The step to do is gold with a short note (time left, "Game 3", "Live"); a done step is
  green. A step is a button that opens its room. It replaces the first-visit guide card, which is deleted.
- **Roster slots.** One circle per roster place, dashed while empty, gold with the player's initials once bought.
  Replaces "0 of 6 players" and the "buying 6 lets you rotate" paragraph.
- **Bars.** Credits left is a number, a gold bar and the total. The part of a player you own is a blue bar and a
  percent. Each keeps its old sentence as screen-reader text.
- **Pips.** Four pips on a pick card show how fresh a player is: all green when rested, fewer and amber after a recent
  pick. The multiplier bubble (user's choice, 2026-11-09) stays beside them.
- **Pick cards.** Players are cards, two across; the card is the toggle. The count turns green when full. A player the
  app would start for an empty pick carries an "Auto" pill.
- **Outline score.** An unverified score is drawn in outline and fills in once verified. The word "unofficial" and its
  "?" stay in the strip.
- **Dock icons.** The phone dock shows a drawn icon over each label.
- **Removed text.** The guide card; "X starts … Picks for game 1 open here …"; the tiredness paragraph; "Points a game
  at …"; "You play X."; the bye sentence (the strip says Bye); "Picks lock when …" (now the last sentence behind the
  pick card's "?"); "You have 2 picks. Clear one to change."; "If you don't pick, X plays." (the Auto pill);
  "Unofficial until a keeper verifies."; "Up to 6 players. Remove one first."; the stat-table legend (each letter head
  carries its full name as title and accessible name); Join a league's "Every league uses the same players …";
  Sign in's "We'll email you a 6-digit code." (the button says "Email me a code"); "You don't have a team this season.".
- **Shortened.** "Buying closed for X. Once shares are settled …" is "X: buying closed". "16 a game" is "16 pts/g".
  The share pool ("240 shares") shows only once it passes the floor.

## Text that stays, on purpose

- Donation and credits lines (PRODUCT.md brand commitments): legal, not hints.
- Error messages and refusals.
- Labels, column heads, button words, status words.
- The "?" popovers and the Rules page: rules are one tap away, never on the working screen.
- Lines that state what happened in a game ("Ari was out, so Finn played.").

## Calls made by the builder (not the user's)

- Roster slots sit in the sticky buy header instead of a second grid of player cards during buying: the bought rows
  already sit first in the list, and a grid would repeat them. The card grid is used once shares are settled.
- No points column in the buy list: at 375px the name would get 67px. The number stays under the name as "pts/g".
- The "?" help buttons stay.
- The tally board and Admin were not touched. The tally board's "Hold a stat to take one off" has no visual
  replacement yet; Admin is allowed to be dense (frontend-principles).

## Not done

- DESIGN.md: a "Refresh" section at the top states what this change supersedes; the older passages below it were not
  rewritten line by line.
- Light mode and desktop widths were not looked at. The sim was checked at 375px in dark: buying open, a buy, each
  room, and game day with one player.
- A real game day (two starters, live score in outline) is covered by unit tests only.

## Checks

`npm run typecheck`, `npm run lint`, `npx vitest run src/app --maxWorkers=2` (761 tests) pass. DB tests were not run:
nothing under `supabase/` or `src/core/` changed.
