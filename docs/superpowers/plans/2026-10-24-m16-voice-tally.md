# M16 Voice Tally Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Every implementer and reviewer invokes `ponytail:ponytail` and `caveman` first; every subagent runs on opus.

**Goal:** A hold-to-talk mic on the tally board: spoken stat calls become waiting stats on the moved players' cards, which the keeper fixes and then adds or discards.

**Architecture:** The phone records (MediaRecorder → 16 kHz WAV), a new Edge Function `voice` passes the clip to Groq `whisper-large-v3`, and the phone reads the transcript with a pure parser in `src/core/voice.ts`. The waiting set is pure state (`src/app/tally/waiting.ts`); `TallyBoard` shows it as a Heard group and turns it into ordinary queued taps on Add, so saving, merging and verifying are unchanged. A `voice_tally` season setting (default on, stored only when off) is the kill switch.

**Tech Stack:** Vite + React 19 + TypeScript, react-router 8 hash routing (data router: `useBlocker`), Supabase JS (`functions.invoke`), Deno Edge Function, vitest + Testing Library (jsdom). No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-24-m16-voice-tally-design.md` (approved 2026-10-24). Read it with this plan.

## Rulings made while planning

1. **Counts** expand into repeated events: `parseStats` still returns `VoiceEvent[]`, and "two Ds" is two `{ athleteId, stat: 'block' }` entries. A number above 5 is ignored and the stat counts once. A stat with an explicit number (1–5) is never deduped; "a" and "an" are not numbers (one is the default), so "for a score" after a pass is still one goal.
2. **The hint is built on the phone**: `whisperHint(names)` moves into `src/core/voice.ts` and is sent to `voice` as `prompt`, so the phone can spot a **prompt echo** (Whisper sometimes returns its prompt for a silent clip): `isEcho(text, hint)` → the call counts as "Didn't hear anything".
3. **Stripping `voice_tally`** happens in the two `api` writers in `src/app/lib/rpc.ts` (`createSeason`, `updateSeasonSettings`), the one place both admin writers go through, via `storedSettings()` in `src/core/settings.ts`.
4. **Leave confirm** is a small in-page `role="alertdialog"` with **Stay** / **Drop and leave** (the spec's words; `window.confirm` can't name its buttons). It lives in a `LeaveGuard` component that `TallyBoard` mounts **only while stats wait**, because `useBlocker` needs a data router and the existing board tests render in `MemoryRouter`.
5. **"Quiet" for the reveal** = no pointer down on the board's player lists (`ul.list`) and 1 s since the last pointer up there. The mic's own presses don't count.
6. **Two empty clips in a row** = two consecutive calls that came back unreadable (WAV conversion failed) or empty (no text, or a prompt echo). The second shows "Voice can't use the microphone here. Try Safari, or tap." and the mic stays usable.
7. **Notes by the mic** clear after 6 s; a note with Undo clears after 5 s. A new note replaces the old one.
8. **Heard cards for players who can't take stats** ("On your team", Out of this game) carry a `pill warn` "Not added"; their waiting stats are left out of **Add N** and out of Finish's unsaved count.

## Global Constraints

- **No real names in the repo** (it is public): tests, comments, fixtures, commit messages and docs use made-up names. Copy `voice-test` files and rewrite every name; never cherry-pick or merge `voice-test`.
- No migration. No new npm dependency.
- Groq model `whisper-large-v3`, `language=en`, `temperature=0`; secret `GROQ_API_KEY`; the function logs only timing and status, never what was said.
- Design values only in `src/app/tokens.css` (`src/app/tokens.test.ts` must stay green); the tally board never moves (no transition, lift, squeeze or fade on anything new); the bright board covers every new piece with daylight contrast; phone first at 375 px.
- New buttons on the board live inside `section.page` so the board's button-motion exemption (`.page:has(.tally-bar) *`) covers them; every target at least `--tap` (44 px).
- Copy fixed by the spec (exact): "Listening… let go when done"; the busy mic "Hearing…"; "Hold the button while you talk."; "Allow the microphone for this site to use voice."; "Voice needs signal. The buttons still work."; "Voice didn't answer. Try again, or tap."; "Voice is busy. Wait a few seconds, or tap."; "Voice isn't working right now. The buttons still work."; "Didn't hear anything. Hold the button while you talk."; "Heard “{text}” but no player and stat. Try “{first name} gets a D”."; "Not added yet. Tap a stat to add one, hold to take one off."; "Nothing waiting to take off."; "Added {n} stats."; "Dropped {n} stats." + Undo; "Leave and drop {n} stats you haven't added: {list}?" with Stay / Drop and leave; "Voice can't use the microphone here. Try Safari, or tap."; mic label "Hold to talk. Say a player and a stat."; hint line "Or hold the mic and say “{first name} gets a D”. Nothing is added until you tap Add."; Settings label "Voice tally: mic on the tally board". Singular "stat" when n = 1.
- Limits fixed by the spec: 15 s recording cap; 0.4 s minimum; 10 s answer timeout; counts 1–5; names 1–80, each 1–60 characters, no `<`, `>` or line breaks; WAV under 2 MB; prompt cut at 700 characters; reveal waits 1 s.
- Tests: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run <files> --maxWorkers=2`. Per task gate: `npm run lint`, `npm run typecheck`, the task's test files. Full suite and build only through the shared lock: `bash /c/Users/19195/Documents/Tribe-Fantasy-m15/.superpowers/sdd/2026-10-22-m15-p9/heavy.sh npx vitest run --maxWorkers=2` (Bash timeout 600000).
- Worktree `C:\Users\19195\Documents\Tribe-Fantasy-voice`, branch `m16-voice`; `node_modules` is a junction to the main checkout's (never delete it with `rm -rf`; `cmd /c rmdir` first). Commit messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

**Admin powers:** the `voice_tally` switch (Admin → Settings) is the only new power; admins use the mic like keepers and may tally anyone; voice stats are ordinary taps (Verify, hold-to-undo, corrections, Undo game unchanged).

**Destructive actions:** Discard → undo (5 s). In-app leave with waiting stats → confirm naming them. Close/reload → dropped silently (user OK). Add → undo by hold-to-undo. Switch off → not destructive.

## Review Focus

1. **A silent or accidental hold** makes Whisper echo its prompt ("{name} gets a D. {name} to {name}…"): the keeper expects "Didn't hear anything", not waiting stats nobody said. Test: Task 1 `isEcho`, Task 5 VoiceMic treats an echo as empty.
2. **The answer lands while the keeper's finger is on another card**: the Heard group must not appear (and the list must not shift) until the finger lifts and 1 s passes. Test: Task 6 "waits for a quiet board".
3. **Another keeper already tapped the same play**: the Heard card's number must equal what the board shows after Add (merged once), and the added tap must carry the call's start time. Test: Task 6 "preview merges with another keeper's tap".
4. **Letting go while the mic permission prompt is up** (first use): nothing records, nothing is sent, the next hold works. Test: Task 4 "let go during the permission prompt".
5. **Two roster names that sound alike** after the sound rule (Toby Grant, Tobi Lane): "Toby" alone matches nobody; "Grant" and "Lane" still work. Test: Task 1.

---

### Task 1: Parser (`src/core/voice.ts`)

**Files:**
- Create: `src/core/voice.ts` (from `git show voice-test:src/core/voice.ts`, names rewritten)
- Create: `src/core/voice.test.ts`

**Interfaces:**
- Produces: `interface VoiceEvent { athleteId: string; stat: string }`; `parseStats(text: string, roster: { id: string; name: string }[], stats: readonly string[]): VoiceEvent[]`; `whisperHint(names: string[]): string`; `isEcho(text: string, hint: string): boolean`.

- [ ] **Step 1: Copy the file.** `git -C . show voice-test:src/core/voice.ts > src/core/voice.ts`, then replace every real name in comments with made-up ones (the doc comment's example becomes "Toby gets a D"; the sound-alike comment becomes "Tobie, Tobey, Toby → tobi"). Drop the "(the Gemini column)" remark: there is no Gemini column.
- [ ] **Step 2: Write the failing tests** in `src/core/voice.test.ts`:

```ts
const roster = [
  { id: 'toby', name: 'Toby Grant' }, { id: 'tobi', name: 'Tobi Lane' }, { id: 'bo', name: 'Bo Stone' },
  { id: 'maxO', name: 'Max Ortiz' }, { id: 'maxL', name: 'Max Lowe' }, { id: 'jl', name: 'Jean Luc Moreau' },
];
const stats = ['goal', 'assist', 'block', 'callahan', 'turnover'];
const parse = (text: string, s: readonly string[] = stats) => parseStats(text, roster, s).map((e) => `${e.athleteId} ${e.stat}`);

it('reads everyday calls', () => {
  expect(parse('Grant gets a D.')).toEqual(['toby block']);
  expect(parse('Bo turns it over')).toEqual(['bo turnover']);
  expect(parse('Bo gets a D and scores, Ortiz drops it')).toEqual(['bo block', 'bo goal', 'maxO turnover']);
});
it('reads passes once, and a three-part name heard word by word', () => {
  expect(parse('Bo to Ortiz for the score.')).toEqual(['bo assist', 'maxO goal']);
  expect(parse('Bo turns it over to Ortiz')).toEqual(['bo turnover']);
  expect(parse('Bo throws to Jean Luc Moro for a score.')).toEqual(['bo assist', 'jl goal']);
});
it('needs a name only one player has, after the sound rule', () => {
  expect(parse('Max scores')).toEqual([]);
  expect(parse('Toby scores')).toEqual([]); // Toby and Tobi sound the same
  expect(parse('Lowe with the D, Lane assist')).toEqual(['maxL block', 'tobi assist']);
  expect(parse('Bow gets a dee')).toEqual([]); // no typo tolerance
});
it('counts 1 to 5, always adding', () => {
  expect(parse('Bo gets two Ds')).toEqual(['bo block', 'bo block']);
  expect(parse('Ortiz 2 turnovers, Grant three goals')).toEqual(['maxO turnover', 'maxO turnover', 'toby goal', 'toby goal', 'toby goal']);
  expect(parse('Bo two Ortiz')).toEqual(['bo assist', 'maxO goal']); // a number before a name is a pass
  expect(parse('Bo 20 turnovers')).toEqual(['bo turnover']); // above 5: the number is ignored
  expect(parse('Bo scores, Bo two goals')).toEqual(['bo goal', 'bo goal', 'bo goal']);
});
it('reads plurals, ignores what the season does not count, and garbage', () => {
  expect(parse('Bo two dees, Ortiz two throwaways')).toEqual(['bo block', 'bo block', 'maxO turnover', 'maxO turnover']);
  expect(parse('Bo Callahan', ['goal', 'block'])).toEqual([]);
  expect(parse('Zorba Wadda, Q.Q. Q.Q. Q.Q. Q.Q. Q.Q.')).toEqual([]);
});
it('builds the hint from real names and spots its echo', () => {
  const hint = whisperHint(['Bo Stone', 'Max Ortiz']);
  expect(hint).toBe('Bo Stone gets a D. Max Ortiz to Bo Stone for the goal. Max Ortiz turns it over. Bo Stone assist. '
    + 'Max Ortiz Callahan. Players: Bo Stone, Max Ortiz.');
  expect(isEcho(' Bo Stone gets a D. Max Ortiz to Bo Stone for the goal.', hint)).toBe(true);
  expect(isEcho('Bo Stone gets a D', hint)).toBe(false); // a real short call matches the hint's start: not an echo
});
```

- [ ] **Step 3: Run, expect FAIL** (counts, plurals, `whisperHint`, `isEcho` missing): `npx vitest run src/core/voice.test.ts --maxWorkers=2`.
- [ ] **Step 4: Implement.** Add the plural phrases (Ds, dees, goals, assists, turnovers, turns, drops, throwaways, callahans, blocks already there). Counts: `one`…`five` and `1`…`5`, read only when the next phrase is a stat (`a`/`an` stay ignored, ruling 1); a number token not followed by a stat but followed by a name keeps its `PASS` meaning (`two`/`2`); numbers above 5 (digits) are skipped. `whisperHint` = the `voice-test` function's text (`supabase/functions/voice-test/index.ts`, `whisperHint`), moved here. `isEcho(text, hint)`: true when the transcript, lower-cased with punctuation dropped and spaces collapsed, has at least 8 words and is a substring of the hint normalised the same way.
- [ ] **Step 5: Run, expect PASS**; `npm run lint`; `npm run typecheck`.
- [ ] **Step 6: Commit** `git add src/core/voice.ts src/core/voice.test.ts && git commit` ("M16 T1: voice parser with counts, plurals and the Whisper hint").

### Task 2: The `voice_tally` switch

**Files:**
- Modify: `src/core/settings.ts` (interface, `DEFAULT_SETTINGS`, `CHECKS`, new `storedSettings`)
- Modify: `src/core/settings.test.ts`
- Modify: `src/app/lib/rpc.ts:86-88` (`createSeason`, `updateSeasonSettings`)
- Create: `src/app/lib/rpc.settings.test.ts`
- Modify: `src/app/pages/admin/SettingsEditor.tsx`, `src/app/pages/admin/SettingsEditor.test.tsx`

**Interfaces:**
- Produces: `SeasonSettings.voice_tally: boolean` (default `true`); `storedSettings(s: SeasonSettings): Record<string, unknown>` (a copy without `voice_tally` when it is `true`); `api.createSeason(name: string, settings: SeasonSettings)`, `api.updateSeasonSettings(seasonId: string, settings: SeasonSettings)`.

- [ ] **Step 1: Failing tests.** `settings.test.ts`:

```ts
it('voice tally is on by default and stored only when off (M16 §5.7)', () => {
  expect(parseSettings({}).voice_tally).toBe(true);
  expect(parseSettings({ voice_tally: false }).voice_tally).toBe(false);
  expect(() => parseSettings({ voice_tally: 'yes' })).toThrow(/voice_tally must be true or false/);
  expect('voice_tally' in storedSettings(parseSettings({}))).toBe(false);
  expect(storedSettings(parseSettings({ voice_tally: false })).voice_tally).toBe(false);
  expect(storedSettings(DEFAULT_SETTINGS)).toEqual(Object.fromEntries(Object.entries(DEFAULT_SETTINGS).filter(([k]) => k !== 'voice_tally')));
});
```

`rpc.settings.test.ts` (mock `./supabase` with an `rpc` spy resolving `{ data: 'id', error: null }`): `createSeason('Spring', DEFAULT_SETTINGS)` and `updateSeasonSettings('se', parseSettings({}))` send `p_settings` without a `voice_tally` key; `updateSeasonSettings('se', parseSettings({ voice_tally: false }))` sends `voice_tally: false`.
`SettingsEditor.test.tsx`: the editor shows a checkbox "Voice tally: mic on the tally board", checked for `{}`; unticking it and saving calls `api.updateSeasonSettings` with `voice_tally: false`; saving with it ticked passes `voice_tally: true` (the strip is rpc's job).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** `voice_tally: bool` in `CHECKS`; `storedSettings` in `settings.ts` with a one-line comment naming the reason (pre-M16 parsers refuse unknown keys). In `rpc.ts` both writers send `storedSettings(settings)`. `SettingsEditor`: a third heading "Tally" with the checkbox; carry it through the existing pending-edit mechanism (`fieldsOf` adds `voice_tally: 'on' | 'off'`; `withFields` sets `next.voice_tally` when changed), so the JSON box and the fields still never both apply.
- [ ] **Step 4: Run, expect PASS** (plus `SeasonsPanel.test.tsx`); lint; typecheck.
- [ ] **Step 5: Commit** ("M16 T2: voice_tally switch, stored only when off").

### Task 3: Edge Function `voice` and the runbook

**Files:**
- Create: `supabase/functions/voice/index.ts` (from `git show voice-test:supabase/functions/voice-test/index.ts`, Groq only)
- Modify: `docs/setup-supabase.md` (new section "Voice tally (Edge Function `voice`, no migration)")
- Local only, not committed: `sim/vite.config.ts`, `sim/fakeSupabase.ts` in the worktree

**Interfaces:**
- Produces: `POST /functions/v1/voice`, multipart `audio` (WAV File, 1 byte–2 MB), `names` (JSON string array, 1–80, each 1–60 chars, no `<`, `>`, CR, LF), `prompt` (string ≤ 700 chars). Answers: 200 `{ text: string }`; 403 `{ error: 'FORBIDDEN' }`; 400 `{ error: 'BAD_REQUEST' }`; 429 `{ error: 'BUSY' }` (Groq 429); 502 `{ error: 'UPSTREAM' }` (any other Groq failure or a missing secret). CORS on every answer.

- [ ] **Step 1: Write the function.** Keep from `voice-test`: the `Deno` declaration, `cors`/`json`, `list()` validation, the `is_keeper` gate with the caller's token, `call()`/`transcribe()`. Drop OpenAI, Gemini, `timed`, the `stats` field and the hint builder (the phone sends `prompt`, ruling 2). Groq request: `model=whisper-large-v3`, `prompt` (the phone's, `.slice(0, 700)`), `language=en`, `temperature=0`, `response_format=json`, file name `clip.wav`. Log one line per request: `console.log(JSON.stringify({ ms, status }))`. CORS (spec §5.2): `Access-Control-Allow-Origin` echoes the request's `Origin` only when it is `https://nealthezeng.github.io` or `http://localhost:<port>` (the `voice-test` version allowed `*`). Header comment: what it does, "Deployed by pasting into the dashboard; Verify JWT may stay on", secret `GROQ_API_KEY`. No real names anywhere.
- [ ] **Step 2: Lint** `npx eslint supabase/functions/voice/index.ts` (the function can't run locally: no Deno).
- [ ] **Step 3: Runbook section** in `docs/setup-supabase.md`, from spec §7 steps 1–6 verbatim in meaning: secret, deploy via editor named `voice`, push, leave the board and come back (or reopen the app) to get the mic, voice is on by default, the practice check list, rollback (Admin → Settings off, with the pre-M16-build warning). Remove nothing about `voice-test` (it was never documented on main).
- [ ] **Step 4: Point the local sim at it (not committed).** In `sim/vite.config.ts` rename the endpoint to `/__voice`, accept the phone's `prompt` field, call only `whisper-large-v3`, return `{ text }`; in `sim/fakeSupabase.ts` make `functions.invoke` post to `/__voice` and resolve `{ data: { text }, error: null }` (or `{ data: null, error }` with `context` = the `Response` on non-2xx).
- [ ] **Step 5: Commit** `supabase/functions/voice/index.ts docs/setup-supabase.md` ("M16 T3: voice Edge Function (Groq whisper-large-v3) and runbook").

### Task 4: Recording and hearing

**Files:**
- Create: `src/app/lib/wav.ts`, `src/app/lib/wav.test.ts` (copied from `voice-test`, unchanged except names: there are none)
- Create: `src/app/tally/useRecorder.ts`, `src/app/tally/useRecorder.test.ts`
- Create: `src/app/tally/hear.ts`, `src/app/tally/hear.test.ts`

**Interfaces:**
- Consumes: `toWav(recording: Blob): Promise<Blob>` (wav.ts); `whisperHint`, `isEcho` (Task 1).
- Produces:
  - `canRecord(): boolean` (`navigator.mediaDevices?.getUserMedia` and `MediaRecorder` exist).
  - `useRecorder(onClip: (clip: Blob, startedAt: string) => void): { listening: boolean; error: string | null; start(): void; stop(): void; clearError(): void }`. `startedAt` = ISO time of the press. Opens the mic on the first `start`, keeps the stream until unmount or `visibilitychange` → hidden, `navigator.vibrate?.(20)` when recording begins, stops itself at 15 000 ms, drops clips under 400 ms with error "Hold the button while you talk.", permission refusal → "Allow the microphone for this site to use voice.", `stop()` before the stream arrives → no recording.
  - `type Heard = { text: string } | { error: 'timeout' | 'busy' | 'broken' | 'unreadable' }`; `hearClip(clip: Blob, names: string[]): Promise<Heard>`: `toWav` (throws → `unreadable`), `FormData` with `audio` (`clip.wav`), `names` (JSON), `prompt` (`whisperHint(names)`), `supabase.functions.invoke('voice', { body, signal })` aborted after 10 000 ms (→ `timeout`); a non-2xx with `context.status === 429` → `busy`; any other error → `broken`; a 2xx whose `text` is empty or `isEcho(text, prompt)` → `{ text: '' }`.

- [ ] **Step 1: Copy wav.ts and its test**; run them (PASS).
- [ ] **Step 2: Failing tests.** `useRecorder.test.ts` with fake `navigator.mediaDevices.getUserMedia` (resolving a stream whose tracks have a `stop` spy) and a fake `MediaRecorder` class (records `start`/`stop`, fires `ondataavailable` + `onstop` on `stop()`), fake timers:
  - hold 500 ms → `onClip` once, with a Blob and the press's ISO time;
  - hold 300 ms → no `onClip`, `error` = "Hold the button while you talk.";
  - hold past 15 000 ms → stopped by itself, `onClip` once;
  - `getUserMedia` rejects → `error` = "Allow the microphone for this site to use voice.";
  - **let go during the permission prompt** (`stop()` before `getUserMedia` resolves) → no `MediaRecorder` created; a later hold records normally;
  - `document.visibilityState = 'hidden'` + `visibilitychange`, and unmount → every track's `stop` called.
  `hear.test.ts` with `../lib/wav` and `../lib/supabase` mocked: success → `{ text: 'Bo gets a D' }` and the FormData carries `names` and `prompt === whisperHint(names)`; 429 → `busy`; 500 → `broken`; invoke never settles → `timeout` at 10 000 ms; `toWav` throws → `unreadable`; text equal to the hint's first two sentences → `{ text: '' }`.
- [ ] **Step 3: Run, expect FAIL.**
- [ ] **Step 4: Implement** `useRecorder.ts` and `hear.ts` to the interfaces above.
- [ ] **Step 5: Run, expect PASS**; lint; typecheck.
- [ ] **Step 6: Commit** ("M16 T4: hold-to-talk recorder and hearClip").

### Task 5: The waiting set and the mic controls

**Files:**
- Create: `src/app/tally/waiting.ts`, `src/app/tally/waiting.test.ts`
- Create: `src/app/pages/VoiceMic.tsx`, `src/app/pages/VoiceMic.test.tsx`
- Modify: `src/app/tokens.css`, `src/app/styles.css`

**Interfaces:**
- Consumes: `VoiceEvent` (Task 1); `QueuedTap` (`src/app/tally/queue.ts`); `useRecorder`, `canRecord`, `hearClip` (Task 4).
- Produces:
  - `interface WaitingStat { athleteId: string; stat: string; at: string }`;
    `interface WaitingSet { heard: string; players: { athleteId: string; at: string }[]; stats: WaitingStat[] }`.
  - `joinCall(set: WaitingSet | null, events: VoiceEvent[], text: string, at: string): WaitingSet` (events non-empty; new players appended in the order first named with `at`; existing players keep their `at`; every event becomes a stat at `at`; `heard` = `text`).
  - `bump(set, athleteId, stat): WaitingSet` (one more, at that player's `at`).
  - `drop(set, athleteId, stat): WaitingSet | null` (removes the newest such stat; `null` when none waits; the player stays in `players`).
  - `waitingCount(set, athleteId, stat): number`; `addable(set, canAdd: (athleteId: string) => boolean): WaitingStat[]`.
  - `toQueued(stats: WaitingStat[]): QueuedTap[]` (`id` = `crypto.randomUUID()`, `tapped_at` = `at`, `undoes` = null).
  - `listStats(stats: WaitingStat[], nameOf: (id: string) => string): string` → "Toby Grant Assist, Max Ortiz Goal ×2" (player order, then the board's stat order; labels from `statLabel`).
  - `type VoiceNote = { text: string; undo?: () => void }`.
  - `VoiceMic({ names, online, waiting, note, onNote, onHeard, onAdd, onDiscard }: { names: string[]; online: boolean; waiting: number | null; note: VoiceNote | null; onNote(note: VoiceNote | null): void; onHeard(text: string, startedAt: string): void; onAdd(): void; onDiscard(): void })`. Renders nothing when `!canRecord()`. `waiting === null` → just the mic; a number → the bar: Discard, "Add {n} stats" (disabled at 0), the mic in the same spot.

- [ ] **Step 1: Failing tests.** `waiting.test.ts`: two calls at `t1`, `t2` keep first-named order and each stat's time; `bump` after a second call uses the player's first `at`; `drop` to zero returns a set that still lists the player, and once more returns `null`; `addable` leaves out a blocked player; `toQueued` gives fresh ids and `tapped_at` = `at`; `listStats` text as above.
  `VoiceMic.test.tsx` (`../tally/useRecorder` and `../tally/hear` mocked; the mock recorder calls `onClip(blob, '2026-11-07T15:00:00.000Z')` on `stop`):
  - `canRecord` false → nothing rendered;
  - holding shows "Listening… let go when done", letting go shows the mic as "Hearing…" (disabled), then `onHeard('Bo gets a D', '2026-11-07T15:00:00.000Z')`;
  - offline: the mic is greyed (`aria-disabled`) and a press notes "Voice needs signal. The buttons still work.";
  - `timeout` / `busy` / `broken` → their spec messages via `onNote`; `onHeard` not called;
  - `{ text: '' }` → "Didn't hear anything. Hold the button while you talk."; a second empty (or `unreadable`) in a row → "Voice can't use the microphone here. Try Safari, or tap."; a good call in between resets the run;
  - `waiting={2}` → buttons "Discard" and "Add 2 stats"; `waiting={1}` → "Add 1 stat"; `waiting={0}` → Add disabled; the mic is still there;
  - a note clears itself after 6 000 ms; a note with `undo` shows an "Undo" button and clears after 5 000 ms.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `waiting.ts`; `VoiceMic.tsx` (pointer capture on the mic, `onContextMenu` prevented, Space/Enter hold on keydown without repeat, release on keyup; label "Hold to talk. Say a player and a stat."; listening bar and notes `role="status"`, errors `role="alert"`); styles: new tokens in `tokens.css` (`--mic-size: 72px`, `--waiting` = `--link` in dark and the bright board's `--link`, `--on-waiting`), new classes in `styles.css`: `.voice-mic` (fixed bottom right, round, gold), `.voice-listen` (full-width bottom bar, `--bar` / `--bar-fg`, gold ring), `.voice-bar` (fixed bottom, Discard 1fr / Add 2fr / mic), `.voice-note`, and bottom padding on `.page:has(.voice-mic)` so the mic never covers the last card or Finish. No transitions or animations.
- [ ] **Step 4: Run, expect PASS** (plus `tokens.test.ts`); lint; typecheck.
- [ ] **Step 5: Commit** ("M16 T5: waiting set and the mic controls").

### Task 6: The board (`TallyBoard`)

**Files:**
- Modify: `src/app/pages/TallyPage.tsx` (`TallyBoard`, `StatButton`; new `LeaveGuard` in the same file)
- Create: `src/app/pages/TallyPage.voice.test.tsx`
- Modify: `src/app/styles.css` (`.tally-buttons button.waiting`, `.tally-new`, `.voice-heard`, `.voice-leave`)

**Interfaces:**
- Consumes: `parseStats` (Task 1); `parseSettings(...).voice_tally` (Task 2); `canRecord` (Task 4); `WaitingSet`, `joinCall`, `bump`, `drop`, `waitingCount`, `addable`, `toQueued`, `listStats`, `VoiceNote`, `VoiceMic` (Task 5); existing `mergeTaps`, `queuedToTap`, `GameControls`'s `unsaved`.
- Produces: `StatButton` gains optional `mark?: number` (> 0 → class `waiting` and a `span.tally-new` "+{mark}"; the aria-label adds ", {mark} waiting").

- [ ] **Step 1: Failing tests** in `TallyPage.voice.test.tsx`. Render with `createMemoryRouter([{ path: '/tally', element: <TallyPage /> }, { path: '/', element: <p>Home</p> }], { initialEntries: ['/tally?game=game'] })` + `RouterProvider`; reuse `TallyPage.test.tsx`'s mocks (auth, stats, GameControls recording its props, supabase tables; add a `seasons` row whose settings the test sets); mock `./VoiceMic` with a stub exposing buttons that call `onHeard(text, '2026-11-07T15:00:00.000Z')`, `onAdd`, `onDiscard`, and rendering `note`; athletes "Bo Stone", "Max Ortiz", "Toby Grant".
  - **a call builds the Heard group**: `onHeard('Ortiz gets a D')` → the first card is Max Ortiz, under the heard line “Ortiz gets a D”, with D showing 1 and "+1"; nothing is queued (`loadQueue('k1','game')` empty);
  - **fixing on the card**: tap D → "+2"; hold (minus key) twice → "+0"; once more → "Nothing waiting to take off.";
  - **Add**: after the call and one tapped fix (D "+2"), queues 2 taps, both `tapped_at` = '2026-11-07T15:00:00.000Z', the group goes, note "Added 2 stats.";
  - **preview merges with another keeper's tap**: a saved tap by keeper `k2` on Ortiz D at 15:00:02 → the Heard card shows D 1 (not 2) with "+1";
  - **Discard + Undo**: Discard → group gone, note "Dropped 1 stat." with Undo; Undo → group back with the same stats;
  - **nothing understood**: `onHeard('nice huck')` → note “Heard “nice huck” but no player and stat. Try “Bo gets a D”.” (first picked player, else first A→Z); no group;
  - **waits for a quiet board**: `pointerdown` on a card in "Everyone else", then `onHeard('Ortiz gets a D')` → no group; `pointerup` + 999 ms → still none; +1 ms → group shown and `window.scrollTo` called with top 0;
  - **leave asks first**: with stats waiting, "← Games" → `alertdialog` "Leave and drop 1 stat you haven't added: Max Ortiz D?"; Stay → still on the board, stats waiting; again + "Drop and leave" → the games list, nothing queued;
  - **who can't take stats**: Ortiz owned by the keeper → Heard card with "Not added", the mock bar gets `waiting={0}`;
  - **Finish waits**: `GameControls` gets `unsaved` with `game` → queue length + addable waiting;
  - **switch off / closed**: `voice_tally: false` → no `VoiceMic` and no hint line; a verified session → no `VoiceMic`;
  - **hint line**: voice on → "Or hold the mic and say “Bo gets a D”. Nothing is added until you tap Add."
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement in `TallyBoard`:**
  - the board's load also reads `seasons.settings` for the session's season (`voice = parseSettings(settings).voice_tally`, `false` if it throws), so a reload after an admin's change applies;
  - state `waiting: WaitingSet | null`, `note: VoiceNote | null`; `canAdd(id)` = not owned (non-admins) and not Out of this game;
  - `names` for `VoiceMic`: "Picked this game" first, then everyone else; the example first name = first picked player, else the first A→Z;
  - `onHeard`: `parseStats(text, athletes, stats)`; none → the nothing-understood note; some → apply `joinCall` **when quiet** (ruling 5) then `window.scrollTo({ top: 0 })`;
  - the Heard section above the groups when `waiting`: `p.voice-heard` (`role="status"`) “{heard}”, `ul.list` of those players' cards (excluded from the other groups), the "Not added yet…" line; Heard cards use preview counts = `mergeTaps([...saved, ...queued, ...toQueued(addable(waiting, canAdd)).map((q) => queuedToTap(q, keeperId))], tap_merge_seconds).counts`, `mark` = `waitingCount`, `onAdd` → `bump`, `onSubtract` → `drop` or the hint "Nothing waiting to take off."; a blocked player's head gets `pill warn` "Not added";
  - Add → `setQueue((q) => [...q, ...toQueued(addable(...))])`, clear, note "Added {n} stat(s)."; Discard → clear, note "Dropped {n} stat(s)." with `undo` restoring the same set;
  - `GameControls` `unsaved` = `queue.length + addable(...).length`;
  - `LeaveGuard` (mounted only while `waiting`): `useBlocker(true)`; when blocked, an overlay `div.voice-leave` `role="alertdialog"` with the spec's sentence (`listStats`) and buttons Stay (`reset`) / Drop and leave (clear the set, `proceed`);
  - `VoiceMic` rendered (inside `section.page`) when `voice && !closed`; the hint line under the search box when that holds and `canRecord()`.
- [ ] **Step 4: Run** `TallyPage.voice.test.tsx`, `TallyPage.test.tsx`, `TallyPage.flush.test.tsx`, `StatButton.test.tsx`, `tokens.test.ts`: PASS; lint; typecheck.
- [ ] **Step 5: Look at it** in the local sim (preview "tribe-sim-voice", 375 px, bright board and normal): mic, listening bar, a real call through Groq (key in `.env.development.local`), the Heard group, Add, Discard + Undo, leave confirm. Screenshot for the review.
- [ ] **Step 6: Commit** ("M16 T6: voice on the tally board").

### Task 7: Docs, full gate, review

**Files:**
- Modify: `DESIGN.md` (tally section: the mic, listening bar, Heard group, waiting marks, the bar, notes, no motion), `PRODUCT.md` (keepers can call stats by voice; nothing is added until Add), the spec's new "Amendments" section (rulings 1–8 above)

- [ ] **Step 1: Write the docs** (no real names).
- [ ] **Step 2: Full gate through the lock:** `bash …/heavy.sh bash -c "npm run lint && npm run typecheck && npm run build && npx vitest run --maxWorkers=2"` → all green.
- [ ] **Step 3: Real-name sweep:** a one-off script in the session scratchpad (never in the repo) loads the season's player names from the user's backup (`%USERPROFILE%\Downloads	ribe-backup-2026-10-20.json`, `tables.athletes[].name`) and searches `git log -p origin/main..HEAD` (diffs and messages) for each first and last name, case-insensitive, whole word → no hits.
- [ ] **Step 4: Commit** ("M16 T7: docs").
- [ ] **Step 5: Final whole-branch review** (opus), fix wave if needed, then hand to the user: go-live steps from `docs/setup-supabase.md` "Voice tally" (secret + deploy `voice` **before** the push), push only with the user's OK, tag `m16-voice` (`refs/tags/`), delete the `voice-test` branch, graphify update.
