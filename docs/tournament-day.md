# Tournament-day checklist

One page for whoever runs a tournament weekend: an admin, a coach with stat-keeper access, or a captain. No code
needed. Everything happens on the live site.

**Roles.** *Keepers* (stat_keeper role, e.g. coaches) tally and verify. *Admins* run the tournament and fix
mistakes. A manager can play and keep stats, but **can't verify a game**: every game has their own players in it.
So at least one keeper who is **not** a manager must be there or online to verify each game.

## The week before

1. **Admin → Athletes:** everyone who's playing is opted in. Opted-out players can't be bid on or dealt.
2. **Admin → Tournaments:** add the tournament (name, first and last day). Picks and Start game stop after the
   last day, so get it right; Edit fixes it.
3. **Grant allowance**, then **Open auction** with a close time at least a day before the tournament.
4. Remind managers to bid (League tab). Bids are sealed until the close.
5. After the close: **Run auction**, then **Open tournament**. The confirm shows game 1's pairings.
6. Remind managers to pick for game 1 and set their bench (League tab). Picks can be changed until the game starts.
7. **Admin → Backup:** download the JSON and keep it private.

## Each game

1. **Before the pull:** a keeper opens **Tally** and taps **Start game N**. This locks every team's pick for that
   game. Start only when the game is really about to begin.
2. **During:** every keeper tallies on their own phone. Two keepers tapping the same stat within 10 seconds count
   once. Taps save even with bad signal; the phone uploads them when it's back online.
3. **After the game:** a keeper taps **Finish game N** on the Tally screen. It shows the next game's pairings
   (from the live tally) before you confirm. Finish waits until that phone's taps are saved.
4. **Verify (can wait until the evening):** a keeper who didn't tally the game and isn't a manager opens it in
   **Stats** (games are listed by date and marked **Not verified**), checks the totals and taps **Verify these
   totals**. Stats count toward the standings 48 hours after they're verified.

## Injuries

- The player reports it on their **Me** page, or tells a keeper.
- A keeper taps **Confirm injury** on the Tally screen. Nobody can confirm their own injury.
- From then on, a manager who started that player gets the auto-pick, and can swap their bench player in for the
  rest of the tournament (League tab, once per tournament).
- When the player is back, they tap **I'm back** on their Me page.

## When something goes wrong

| Problem | Fix |
|---|---|
| A game was started by mistake | Admin: open its session (Stats), **Delete session**. The game becomes void: it scores nothing and tires nobody. Then tap **Finish game N** on Tally to pair the next game. Managers pick again for that next game. |
| A wrong stat in a verified game, within 48 h | A keeper opens the game in Stats → **Reopen for more tallying**, fixes the taps, and a keeper verifies again. |
| A wrong stat after 48 h | An admin uses **Correct a stat line** on the session page. An admin who manages one of the players needs a second admin. |
| Nobody can verify ("you own an athlete…") | Get a keeper who isn't a manager. Coaches are the usual verifiers. |
| A phone shows "N unsaved" | Keep the Tally page open on a connection until it clears. Don't sign out or clear the browser. |
| Someone doubts a pairing | Admin → Tournaments → **Check pairings** re-runs the pairing math on what that phone sent. |
| The game ran past midnight on the last day | Nothing to do: Finish is still offered for a live game. |

## After the tournament

1. Every game verified (nothing in Stats marked **Not verified**). Standings settle 48 hours after the last verify.
2. **Admin → Backup:** download the JSON again.
3. The next tournament starts at "The week before".

If the site shows an error about settings right after an update, see "T4 retire weekly" in `docs/setup-supabase.md`.
