# M16 — Voice tally (design)

Date: 2026-10-24. Base: main `a54f991` (M15 done, P9 round 2 live). Branch: `m16-voice` (worktree
`Documents/Tribe-Fantasy-voice`).
Status: approved by the user 2026-10-24 and built on `m16-voice` (plan `docs/superpowers/plans/2026-10-24-m16-voice-tally.md`);
rulings made while planning and building are in §10.
Deadline: live and tried at one practice **before CCCs (Nov 7–8)**: deploy by about **Nov 4**, nothing on the tally
screen changes Nov 6–8.

## 1. Why

Keepers tally by finding a player's card and tapping one of five stat buttons while trying to watch the game. The user
wants to call stats out loud instead ("Toby gets a D", "Max turns it over", "Toby to Max") and only glance at the
screen to confirm. Everything that exists today stays: voice is an extra way in, not a replacement.

Findings this rests on (voice-test work, 2026-10-22/23, branch `voice-test`):
- iPhone Home Screen web apps have historically had no browser speech recognition (`webkitSpeechRecognition`), and the
  app is installed that way (M15 P8). So the phone records audio itself and a server-side speech model hears it.
- In local tries with the real roster, Groq `whisper-large-v3-turbo` once fell into a loop (the same two letters over and over) and
  heard a short first name as a car brand; the full `whisper-large-v3` got all three tries right through our parser, at 600–750 ms.
  Whisper spells rare names the common way (a rare last name, a first name with an unusual spelling) but our parser still finds the player through the parts
  that match. A prompt written like a sample transcript (made-up calls using real names, then the roster) is the hint.
- Cost is pennies a tournament; Groq has a free tier.
- **Not yet tried:** recording on any phone. Every try so far ran on a desktop against the local simulation (a phone
  can't reach it: recording needs HTTPS). Whether the iPhone installed app records, and keeps recording after it
  has been in the background, is the biggest unknown. It is first tried at the practice before Nov 6 (§8).

## 2. Goals

1. A **floating mic button** on the tally board. **Hold** to talk, **let go** to send.
2. What was said becomes **waiting stats** (not saved). The players they belong to **move to the top of the board**,
   with each new stat marked.
3. While stats wait, the keeper **fixes them on those cards** with the usual gestures (tap = one more, hold = one
   fewer), then taps **Add N stats** to save them or **Discard** to drop them.
4. If nothing usable was heard: a **short message** and no change.
5. **Counts**: "Toby gets two Ds", "Max 2 turnovers". A number always **adds**; it never sets a total.
6. Works on an iPhone (installed app and Safari) and Android Chrome, before Nov 7.

## 3. Non-goals

- Voice commands for anything but stats: no "scratch that", no Out marking, no Finish game, no navigation.
- Always-on listening or a wake word. It only listens while the button is held.
- "Set the total" phrasing ("Toby has 2" never means "make it 2").
- Voice without signal. Buttons keep working offline exactly as today.
- Several speech models, a model picker, or an LLM reading the transcript.
- Keeping audio or transcripts anywhere (no table, no log).
- Voice on any page but the tally board.

## 4. Anti-goals (fails even if it works)

- A voice stat is saved without the keeper tapping **Add**.
- One play counted twice because a voice keeper and a tapping keeper both recorded it (§5.4: spoken time).
- The board gets slower or harder to hit: the mic or the bar covers stat buttons or the game controls, or cards move
  under a keeper's thumb mid-tap (the reason for ruling 15).
- Voice failing (no signal, Groq down, key missing) breaks or slows manual tallying.
- The Groq key reaches the browser bundle.

## 5. What gets built

Standing rules: admin powers are in §5.7; destructive actions and their undo/confirm in §5.8. UI follows DESIGN.md and
tokens.css; the tally board stays exempt from motion (no animation when cards move up). Player-facing word: "game".

### 5.1 The mic button

- Round, floating at the bottom right of the **tally board** (`TallyBoard` in `src/app/pages/TallyPage.tsx`), large
  enough to find without looking (my call: about 72 px). The board gets bottom padding so the mic never covers the
  last card or `GameControls`.
- **Shown** to keepers and admins when the season's voice switch is on (§5.7), the board is open (not verified, not an
  earlier season), and the browser can record (`navigator.mediaDevices.getUserMedia` and `MediaRecorder` exist).
  Otherwise it isn't there at all.
- **Offline** (the board's existing `online` state): the mic stays but is greyed out, and pressing it says "Voice needs
  signal. The buttons still work."
- **Hold** (pointer down) starts recording; **let go** sends. Pointer capture, so sliding the thumb off the button
  doesn't cancel. No long-press menu or text selection (same CSS guards as the stat buttons). Keyboard: holding Space
  or Enter on the focused button does the same. My call: a short buzz (`navigator.vibrate`) when recording starts.
- **While held**: a big "Listening… let go when done" bar at the bottom of the screen, so it is obvious the phone is
  hearing. Stops by itself at **15 s**.
- **Too short** (under 0.4 s): "Hold the button while you talk." Nothing is sent.
- **Microphone**: the first hold asks permission. If refused: "Allow the microphone for this site to use voice." The
  mic stream is opened on the first hold and kept while the board is open (no wait on later holds), and released when
  leaving the board or when the app goes to the background (so the phone's mic indicator doesn't stay on).
- **While sending**: the mic shows it is busy ("Hearing…") and can't be held again until the answer comes back or
  fails.

### 5.2 Hearing (Edge Function `voice`)

- The phone records with `MediaRecorder` (webm on Chrome, mp4 on iPhone), converts the clip to 16 kHz mono WAV
  (`src/app/lib/wav.ts` from the `voice-test` branch) and posts it with the board's player names to a new Edge
  Function **`voice`**.
- `voice` (Deno, pasted in the dashboard like `notify` and `venmo-intake`): answers only signed-in keepers and admins,
  checked by calling `is_keeper` through PostgREST with the caller's own token (so it holds whether or not "Verify
  JWT" is on). Validates the upload (WAV under 2 MB, 1–80 names, each 1–60 characters, no `<`, `>` or line breaks).
  Calls Groq `whisper-large-v3` with `language=en`, `temperature=0` and the transcript-style hint (`whisperHint` from
  `voice-test`), and returns `{ text }`. Secret: `GROQ_API_KEY`. CORS for the site's origin and localhost.
- `voice` logs only timing and errors, **never** what was said.
- Names sent: the board's players, **picked-this-game players first** (Whisper's prompt is capped at 224 tokens, so a
  roster past about 35 names loses the last ones; my call).
- Failures the keeper sees (message by the mic, waiting stats untouched):
  - no answer in 10 s: "Voice didn't answer. Try again, or tap."
  - Groq busy (429): "Voice is busy. Wait a few seconds, or tap."
  - anything else: "Voice isn't working right now. The buttons still work." (detail in the console only)
- The transcript is read **on the phone** by `parseStats` in `src/core/voice.ts` (§5.3).
- Groq's limits on the free plan (checked 2026-10-24): 20 requests a minute, 2,000 a day, 7,200 audio seconds an hour;
  Groq counts each clip as at least 10 s. Two keepers calling every few seconds stay under that; a 429 is handled
  as above.

### 5.3 Reading the transcript (`src/core/voice.ts`)

Starts from `voice-test` (commits b51aabf, f3ac655) and keeps what it does:
- A **player** is found by full name, or by a first or last name only they have (two Maxes: "Max" alone matches
  nobody; "Ortiz" or "Max Ortiz" does). Spellings that sound alike read the same (Tobie, Tobey, Tobbi → Tobi); there is
  no typo tolerance (it turned "then" into a player called Theo). A name heard word by word (a three-part name whose
  last part is misspelt) counts once.
- A **stat** goes to the player named before it. Phrases: D, dee, block(s/ed), goal, score(s/d), point, assist(s),
  Callahan(s), turnover, turn (over), turns/turned it over, turf(s), drop(s/ped), throwaway, throw(s)/threw it away,
  stall(ed). Stats the season doesn't count are ignored.
- **"A to B"** (also "two", "too", "hits", "finds") is A's assist and B's goal; "for the score" after it is not a
  second goal; "A turns it over to B" is only A's turnover.

New in M16:
- **Plural stat words**: Ds, dees, goals, assists, turnovers, turns, drops, throwaways, Callahans.
- **Counts 1–5**, as digits or words (one … five; "a" and "an" are 1): a number right before a stat word is how many
  ("two Ds", "2 turnovers", "three goals"). A number right before a **player's name** is still a pass ("Toby two Max").
  Bigger numbers are ignored (more likely a mishearing). A count always **adds**.
- Test fixtures use the patterns from the real tries (sound-alikes, a three-part name with a misspelt last part, two
  players sharing a first name, "to"/"two", a looping garbage transcript that must read as nothing) but **made-up
  names**: the repo is public, so real roster names never go in a test or a comment.
  (`voice-test`'s f3ac655 test uses a real name; replace it when copying.)

### 5.4 Checking it (the waiting stats)

Picked in the browser mockups (option "3A", user 2026-10-23): the stats are fixed **on the moved cards**.

- **Heard line** at the top of the board: “<what was heard>” (the latest call), so the keeper can see what was missed.
- **Heard group**, above "Picked this game" and "Everyone else": every player with waiting stats, in the order first
  named. While stats wait, those players appear **only** there (no duplicate card). When a call's answer arrives the
  board **scrolls to the top** and shows the group. An answer can take a few seconds, and the keeper may be tapping
  other cards meanwhile, so the move **waits until no finger is on the board and 1 s has passed since the last tap**
  (my call, builder check). The group then stays put until **Add** or **Discard**; it never regroups while the keeper
  taps.
- On a Heard card each stat button shows the number the player will have after **Add**: the board's count with the
  waiting stats run through `mergeTaps` as this keeper's taps at their times, so a play another keeper already tapped
  isn't shown one too high (my call, builder check). Buttons with waiting stats are outlined with a "+N" mark. A line
  under the group: "Not added yet. Tap a stat to add one, hold to take one off."
- **Fixing**: on a Heard card, tap adds one waiting stat; hold (or minus/Delete/Backspace) takes one waiting stat off,
  never below zero ("Nothing waiting to take off."). Already-saved stats are changed after **Add** with the usual
  hold-to-undo. My call: keeps the two kinds from mixing. A tap on a Heard card counts as a **fix to the call** (a
  missed assist, a wrong stat), so it gets the call's time, not the tap's (§5.4 Add; my call: reviews last seconds,
  and a new play for a player under review is rare).
- **Players who can't take stats** still show in the group, marked and not counted: "On your team" (a keeper's own
  fantasy players; admins are exempt, as today) and "Out" (Out of this game). Their waiting stats aren't added.
- **The rest of the board works as normal** while stats wait: a tap on any other card saves straight away, as today
  (cards are not dimmed).
- **Another call while stats wait**: its stats join the same waiting set (same player and stat add up), new players
  join the end of the Heard group, the Heard line shows the new call. A call that understood nothing leaves the
  waiting set as it was.
- **The bar**: while anything waits, a bar along the bottom holds **Discard**, **Add N stats** (N = total waiting,
  counting only addable players) and the **mic, in the same spot** as before so the thumb still finds it. All at least
  44 px. **Add** is disabled at N = 0.
- **Add** turns every waiting stat into ordinary queued taps through the existing path (`add` → queue → `save_taps`):
  - `tapped_at` is the **moment the call started** (when the button was pressed) for stats from that call, and for
    fixes tapped on a Heard card, the start of the call that put that player in the group. So a voice call and another
    keeper's tap on the same play fall inside `tap_merge_seconds` (10 s) and count once, however long the keeper takes
    to check. (`save_taps` already corrects the phone's clock, so a time a few seconds old is fine.)
  - Then the Heard group and line go away, the cards return to their groups, and "Added N stats" shows briefly. Saving
    shows in the existing Saved/Saving pill.
- **Discard** drops the waiting set; the cards return. "Dropped N stats. **Undo**" shows for 5 s and puts the set back
  exactly (same stats, same times).
- **Leaving the board** while stats wait drops them (user, 2026-10-23):
  - leaving inside the app (← Games, a tab, the phone's back gesture) asks first, naming the stats: "Leave and drop 2
    stats you haven't added: Toby Grant Assist, Max Ortiz Goal?" with **Stay** and **Drop and leave**;
  - closing the app, reloading, or the phone killing the page just drops them. Waiting stats are never stored on the
    phone.
- If the game is verified while stats wait, **Add** fails like any tap today (the existing rejected-taps banner).
- **Finish game** stays off while stats wait, exactly as it does today while this phone has unsaved taps
  (`GameControls`' unsaved count includes waiting stats), because Finish sets the next game's pairings from the current
  results (my call, builder check).

### 5.5 When nothing was understood

- A short message by the mic, for about 6 s: "Heard “<text>” but no player and stat. Try “<first picked player's first
  name> gets a D”." If Whisper returned nothing: "Didn't hear anything. Hold the button while you talk."
- The board doesn't change. If only part of a call was understood, the understood part waits as usual and the Heard
  line shows the whole transcript.

### 5.6 Words on the board

- One line under the search box when voice is on: "Or hold the mic and say “<first name> gets a D”. Nothing is added until you
  tap Add." (the name from the board's roster, as in §5.5; my call on wording).
- Accessibility: the mic's label says what it does ("Hold to talk. Say a player and a stat."); the listening bar, the
  Heard line and every message are announced (`role="status"`); errors use `role="alert"` like the rest of the board.

### 5.7 The switch, and admin powers

- New season setting **`voice_tally`** (boolean, default **on**) in `SeasonSettings`, `DEFAULT_SETTINGS`, the parser's
  checks and the Admin → Settings editor ("Voice tally: mic on the tally board"). It is the kill switch if voice
  misbehaves at a tournament. `TallyPage` loads the season only once, and a keeper can stay in Tally all day, so
  `TallyBoard` reads the switch again in its own load (every board open and every reload after a save): off hides the
  mic the next time a board loads or refreshes.
- **Pitfall (must design around):** `parseSettings` refuses unknown keys, so any phone still on a pre-M16 build fails
  to load the season once `voice_tally` is stored. Requirement: **nothing stores `voice_tally` while it is on** (the
  default), so nothing breaks until an admin actually turns it off. That covers every writer, through one shared
  helper: the Settings editor's save (its fields and its Advanced JSON box both save the full parsed object today) and
  creating a season (`SeasonsPanel` sends `DEFAULT_SETTINGS`). The runbook says turning it off can break phones still on
  a pre-M16 build until they update (§7 step 3).
- **Admin powers**: admins use the mic like keepers (and, as today, may tally anyone). Voice stats are ordinary taps
  by that keeper, so Verify, hold-to-undo, stat corrections and Undo game work on them unchanged. The switch is the
  only new power. Outside the app, deleting the `voice` function or its secret stops voice too.

### 5.8 Destructive actions

| Action | Undo or confirm |
|---|---|
| Discard | undo: "Dropped N stats. Undo" for 5 s |
| Leave the board inside the app with waiting stats | confirm: "Leave and drop N stats you haven't added: <player stat, …>?" Stay / Drop and leave |
| Close, reload, or the phone kills the page with waiting stats | dropped without asking (can't be caught reliably; user OK 2026-10-23) |
| Add | undo: hold-to-undo on each stat button, as today |
| Voice switch off | not destructive: turn it back on |

## 6. Constraints

- Branch `m16-voice` off main `a54f991`. Reuse from `voice-test` (b51aabf, f3ac655, b610314; never pushed):
  `src/core/voice.ts` + test, `src/app/lib/wav.ts` + test, and the Groq parts of
  `supabase/functions/voice-test/index.ts` as `supabase/functions/voice/index.ts`. **Copy the files and rewrite every
  name in them; never cherry-pick or merge `voice-test`**: its code comments, test roster, hint examples and all three
  commit messages carry real roster names. Not carried over: the `#/voice-test` page and route, and the OpenAI and
  Gemini calls. Delete the `voice-test` branch once its files are copied; it is never pushed.
- **No migration.** The switch lives in `seasons.settings`. No new npm dependency.
- **No real names in the repo** (public): tests, comments and docs use made-up names.
- Tally board rules: no motion (DESIGN.md), bright board covers the new pieces (mic, bar, outlines, "+N" marks,
  messages) with daylight contrast, design values only in tokens.css (tokens.test enforces it), phone first at
  375 px. Ruling 15 (no regrouping under the thumb) holds as described in §5.4.
- The Edge Function can't run locally (no Deno). The untracked local simulation (`sim/` in the voice worktree, port
  5177, launch entry "tribe-sim-voice") already plays the function's Groq call with the key from the gitignored
  `.env.development.local`; keep its hint and request identical to `voice` (rename its `/__voice-test` endpoint to
  match). `VITE_SIM_PLAYERS` puts real names into the sim's roster for local tries; they never reach the repo.
- Tests: parser fixtures (§5.3); `encodeWav`; TallyPage tests with `supabase.functions.invoke` mocked: mic hidden
  when the switch is off, the board is closed or recording isn't supported; greyed offline; a heard call builds the
  Heard group; tap/hold change waiting stats; Add queues taps with the call's start time; Discard and its Undo;
  nothing understood leaves the board unchanged; leaving asks first. Full suites through the shared heavy-run lock,
  `--maxWorkers=2`.
- Go-live order: the user adds `GROQ_API_KEY` to the Edge Function secrets and deploys `voice` **before** the push
  (a board without the function just shows "Voice isn't working right now").

## 7. Go-live (runbook goes in docs/setup-supabase.md "Voice tally")

1. Groq key (the one from the local tries works) → **Edge Functions → Secrets**: `GROQ_API_KEY`.
2. **Edge Functions → Deploy a new function → Via editor**, name `voice`, paste `supabase/functions/voice/index.ts`.
3. Push (deploy). Hard-reload any open admin or keeper tab. An installed app never reloads while a tally board is on
   screen or while offline (M15 P8), so a phone left sitting on a board keeps the old build: keepers leave the board
   (← Games) and come back, or close and reopen the app, to get the mic.
4. Nothing to switch on: voice is on by default.
5. One practice before Nov 6: a keeper on an iPhone **in the installed app** and one on Android each try about ten
   calls (single stats, "A to B", a count, a shared first name, one nonsense call) and add them; check the counts and
   that another keeper's taps on the same plays counted once.
6. Rollback: Admin → Settings, voice tally off (see the §5.7 pitfall), or revert the deploy.

## 8. Tasks (one phase, tag `m16-voice`)

**No early phone check (user, 2026-10-24):** the whole board feature is built first and tried on phones at the
practice before Nov 6 (§7 step 5). What ships if the iPhone installed app can't record is decided then. Until then
the board already copes (my call): if the microphone can't be opened or the clip comes back empty twice in a row, the
mic says "Voice can't use the microphone here. Try Safari, or tap." and the buttons carry on as normal.

1. Parser: copy from `voice-test`, made-up names in tests, plurals and counts (§5.3).
2. Edge Function `voice` + runbook section (§5.2, §7); sim endpoint renamed to match.
3. Recording: a hook for hold-to-talk (permission, 15 s cap, too-short, mic release, WAV) + the mic button and
   listening bar (§5.1).
4. Check step: waiting set, Heard line and group, fixing on the cards, the bar, Add with call-start times, Discard +
   Undo, leave confirm, messages (§5.4–5.6, §5.8).
5. The `voice_tally` switch and its no-store-at-default rule (§5.7).
6. Docs: DESIGN.md (mic, bar, Heard group), PRODUCT.md (voice tally), this spec's amendments; final review; graph
   refresh after ship.

## 9. Left to the builder

Exact sizes and tokens for the mic, bar and marks; the mic icon; how the bar sits with `GameControls`; how in-app
leaving is caught (react-router's blocker or the board's own back handling); message timing; the hook's shape; whether
the WAV conversion runs before or during the upload; any small wording not quoted above.

## 10. Amendments

Made while planning (2026-10-24, the plan's "Rulings made while planning"):

1. **Counts become repeated stats.** `parseStats` still returns one event per stat, so "two Ds" is two blocks. A number
   above 5 is ignored and the stat counts once. A stat with a spoken number (1–5) is never merged with the same stat
   next to it. "A" and "an" are not numbers (one is the default), so "for a score" after a pass is still one goal;
   §5.3's "a and an are 1" would have counted that goal twice.
2. **The hint is built on the phone.** `whisperHint(names)` lives in `src/core/voice.ts` and goes to `voice` as
   `prompt`. Whisper sometimes answers a silent clip with its own prompt; the phone, which holds the hint, spots that
   echo (`isEcho(text, hint)`) and treats the call as "Didn't hear anything".
3. **One place keeps `voice_tally` out of storage.** Both admin writers (the Settings editor and creating a season)
   go through `createSeason` and `updateSeasonSettings` in `src/app/lib/rpc.ts`, which store
   `storedSettings(...)` from `src/core/settings.ts`: the settings without `voice_tally` while it is on (§5.7's
   pitfall).
4. **The leave confirm is in the page.** A small `role="alertdialog"` with **Stay** and **Drop and leave**, since
   `window.confirm` can't name its buttons. It lives in a `LeaveGuard` component holding react-router's `useBlocker`,
   which the board mounts only while stats wait, because `useBlocker` needs a data router and the older board tests
   render in a `MemoryRouter`. As built it mounts only while stats that Add would send wait: with only "Not added"
   stats waiting, leaving doesn't ask.
5. **"Quiet" for the move into the Heard group** (§5.4): no finger down on the board's player lists (`ul.list`) and
   1 s since the last one lifted. The mic's own presses don't count.
6. **Two empty clips in a row** (§8): two calls in a row that came back unreadable (the WAV conversion failed) or empty
   (no words, or a prompt echo). The second shows "Voice can't use the microphone here. Try Safari, or tap." and the
   mic stays usable.
7. **Notes by the mic** go after 6 s, one with Undo after 5 s. A new note replaces the old one.
8. **Heard cards for players who can't take stats** (On your team, Out of this game) carry a `pill warn` "Not added".
   Their waiting stats are left out of **Add N** and out of Finish's unsaved count.

Made during the build (2026-10-24):

9. **The function cuts the prompt itself.** `voice` slices `prompt` to 700 characters and refuses a request only when
   `prompt` is missing, not text, or over 4,000 characters. The phone's full hint can pass 700 on a long roster and
   must still work; 4,000 bounds abuse, and no board gets near it (80 names of at most 60 characters plus the sample
   calls).
10. **No mic on an empty board.** The board shows the mic only when it has players, so there are always names to send
    and `whisperHint` needs no empty-roster case. Were it ever reached, `voice` would refuse the empty name list and the
    keeper would see "Voice isn't working right now".
11. **What counts as a prompt echo.** A transcript is an echo when, with case and punctuation dropped, it is part of
    the hint and either contains the word "players" or has more words than the hint's longest sample call (the part
    before "Players:"). A real call is at most one sample sentence; echoes run across sentences or into the roster.
    The plan's first rule (eight words or more) dropped a real pass called with full names. The silence check (13)
    catches silent clips before this; an echo of two short sample calls side by side can still get through and shows
    as waiting stats the keeper discards.
12. **What `voice` logs.** One line per request, `{ ms, status, groq }`: the time taken, the status it answered with,
    and Groq's HTTP status, `secret` (no key), `network` (Groq unreachable) or null (stopped before Groq). Never the
    request body or the transcript. §5.2 forbids logging what was said, not error codes, and a bad key (Groq's 401) has to be visible at
    go-live.
13. **Silence isn't sent.** `hearClip` skips the call and reads the clip as nothing when its loudest sample is below
    `SILENT_PEAK` (0.01, a calibration constant in `src/app/tally/hear.ts`). Sending silence is what makes Whisper echo
    its prompt; `isEcho` stays for longer echoes. If very quiet speech reads as "Didn't hear anything", lower the
    constant.
14. **`toWav` returns the peak too.** It gives `{ wav, peak }` (peak = the loudest sample, 0 to 1), so the silence
    check doesn't decode the clip a second time.
15. **The mic sits directly in the board's page.** `VoiceMic` is a direct child of the board's `section.page`, never
    inside a `.card` or pane: an ancestor's `backdrop-filter` would trap its `position: fixed` inside that pane.
