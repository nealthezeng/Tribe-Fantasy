# Tournament Mode — App Screens (T3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The screens for tournament play: the League tab's Tournament card (pick for the next game, bench, injury
swap, standings, games), Start/Finish game on the tally screen, Open tournament + Check pairings in Admin → Stages,
and the rules page rewritten. The weekly screens are removed.

**Architecture:** One new data module, `src/app/lib/tournament.ts`, reads a league's tournament rows
(`loadLeagueRows`), maps them to the core input (`toTournamentInput`) and scores them with `scoreTournaments`
(`buildLeagueTournament`). Staff calls load live taps too, so `seasonPairings` can compute the next game's Swiss
pairings from provisional standings for every league of the season, with the inputs (`pairingInputs`) saved in
the `finish_game` audit row for `checkPairing`. Screens: `TournamentCard` replaces `WeeklyCard` on the League tab;
`GameControls` sits on the tally session list (Start / Tally / Finish) and on the live game's board (Finish);
`StagesPanel` gets `TournamentControls` instead of the weeks controls. No migration: `0012` is already live.

**Tech Stack:** React 19 + TypeScript, Supabase (PostgREST reads, security-definer RPCs from 0012), Vitest +
Testing Library (jsdom), PGlite for DB tests.

**Spec:** `docs/superpowers/specs/2026-10-02-tournament-mode-design.md` — §2 rules, §6 UI, §7 pitfalls, and
**Amendments 1–14** at the end (14 records this plan's decisions). Read it first.

## Global Constraints

- Every executor invokes `ponytail:ponytail` first (the user's standing rule): shortest correct diff, no new deps.
- UI follows `DESIGN.md` and `docs/frontend-principles.md`: reuse the classes in `src/app/styles.css` (`card`,
  `stack`, `head`, `meta`, `list`, `pill ok|info|warn|bad`, `notice`, `section`, `secondary`, `muted`); colours and
  sizes only from `src/app/tokens.css`. No new CSS is needed. No UI libraries.
- node/npm are not on the Bash PATH: prefix commands with `export PATH="/c/Program Files/nodejs:$PATH";`.
- Branch `tournament-app` (off `main` ea12337). Never edit an applied migration; this plan adds none.
- Other teams' picks are sealed until their game starts: the UI never shows another team's pick or auto-pick for a
  game that hasn't started (RLS returns no row, so the scorer's guess must not be displayed).
- Never save season settings, set picks, open a tournament or start a game from a local preview: the preview talks
  to the live database (tribe-dev). Visual checks are read-only unless the user says otherwise.
- DB tests time out when run alongside the dev server or other agents: run `npx vitest run tests/db` on its own.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  (or the executor's own model name).

## The verified draft

The whole plan was built and verified while planning: `tsc -b`, `eslint .`, `npm run build`, **227 app/core tests
+ 173 DB tests** green. It lives on the local branch **`t3-verified-draft`** (one commit on top of `main` ea12337,
never pushed). Executors copy their task's files from it instead of retyping, then run the checks:

```bash
git checkout t3-verified-draft -- <file>   # new or modified file, whole
git rm <file>                              # files the task deletes
```

Every file belongs to exactly one task, except `src/app/lib/rpc.ts`: Task 1 adds the tournament wrappers by hand
(the weekly screens still call the weekly wrappers), and Task 4 copies the draft's whole file (which drops them).
Never copy `.impeccable/` or `tsconfig.tsbuildinfo`. Leave `stash@{0}` ("local-untracked-before-cloud-move") alone:
it is the user's. Reviewers compare each task's diff against the spec, not the draft.

## Review Focus

Inputs the spec implies that are most likely to bite real users, and the test that pins each:

1. **An opponent's sealed pick leaks through the auto-pick guess** → for a game that hasn't started, the card says
   "Their pick stays hidden until the game starts" and never names the player the scorer would auto-pick for them →
   "…never the opponent's sealed pick" (Task 2).
2. **A keeper taps Finish while their phone still holds unsaved taps** → those taps would be missing from the
   provisional standings the pairing is frozen on, so Finish stays disabled until the phone says Saved →
   "waits for this phone's unsaved taps before finishing" (Task 3).
3. **Two keepers tap Start (or Finish) at once** → the second sees "Another keeper already started this game." and
   the card reloads to the live state, never a crash or a second session → "says so when another keeper started the
   game first" (Task 3); the database side is pinned in `rpc-tournament.test.ts` (T2).
4. **A game's session is deleted (voided)** → the League tab shows the game as Void and nobody is tired by it; the
   tally list still offers Finish (so the next game can be paired) and never offers Delete on a game's session →
   "marks a game whose tally was deleted as void" (Task 2), "can still finish a game whose session was deleted"
   (Task 3), "labels a game's session and never offers to delete it" (Task 3).
5. **A finish_game audit row that isn't what Finish saves** (malformed or hand-edited) → Check pairings reports a
   mismatch instead of throwing → "flags a pairing that is not the Swiss one" (Task 1).

---

### Task 1: Tournament data layer, RPC wrappers, error messages, DB gaps

**Files:**
- Modify: `src/core/tournament.ts` (split `pairingInputs` out of `nextPairings`), `src/core/tournament.test.ts`
- Create: `src/app/lib/tournament.ts`, `src/app/lib/tournament.test.ts`
- Modify: `src/app/lib/rpc.ts` (by hand: add six wrappers), `src/app/lib/errors.ts`, `src/app/lib/errors.test.ts`
- Modify: `tests/db/rpc-tournament.test.ts` (the gaps T2's final review left for T3)

**Interfaces:**
- Consumes (core, from T1): `scoreTournaments`, `liveStatLines`, `TournamentInput`, `TournamentResult`,
  `swissPairings`; `rowToTap` from `src/app/tally/queue.ts`; `pickAuctionStage`, `AUCTION_STAGE_COLUMNS`,
  `AuctionStage` from `src/app/lib/auction.ts`.
- Produces (later tasks call these exactly):
  - core: `pairingInputs(input: TournamentInput): { order: string[]; meetings: Record<string, number> }`
  - `GameRow`, `GAME_COLUMNS`, `GamePairing { league_id; home; away: string | null }`,
    `LeaguePairingInput { league_id; order; meetings }`, `TournamentRows`
  - `toTournamentInput(rows, now): TournamentInput`, `buildLeagueTournament(rows, now?): LeagueTournament`
    where `LeagueTournament = { settings, input, result, team, athlete, stage: Map<string,string>, injured: Set<string> }`
  - `loadLeagueRows(seasonId, leagueId, { taps? })`, `loadLeagueTournament(seasonId, leagueId)`
  - `seasonPairings(seasonId, now?): Promise<{ pairings: GamePairing[]; provisional: LeaguePairingInput[]; team: Map; league: Map }>`
  - `loadCurrentGame(seasonId): Promise<{ stage: AuctionStage; game: GameRow } | null>`
  - `toPairings(p: LeaguePairingInput): GamePairing[]`, `checkPairing({ pairings, provisional }): boolean`,
    `describePairings(pairings, team): string` ("Zeal vs Flow · Money has a bye")
  - `mergeRanks(results: TournamentResult[], stageId)`, `seasonRanks(seasonId, stageId)`, `fetchAll(page)`
  - `api.openTournament(stageId, pairings)`, `api.startGame(gameId) → session id`,
    `api.finishGame(gameId, pairings, provisional) → next game id`,
    `api.setGamePick(membershipId, stageId, number, athleteId | null)`, `api.setBench(membershipId, stageId, athleteIds[])`,
    `api.swapBench(membershipId, stageId, outAthlete, inAthlete)`

- [ ] **Step 1: Write the failing tests.** Copy the four test files from the draft:

```bash
git checkout t3-verified-draft -- src/core/tournament.test.ts src/app/lib/tournament.test.ts src/app/lib/errors.test.ts tests/db/rpc-tournament.test.ts
```

The core test change (adds `pairingInputs`):

```diff
diff --git a/src/core/tournament.test.ts b/src/core/tournament.test.ts
index 1652ed0..ecb29e5 100644
--- a/src/core/tournament.test.ts
+++ b/src/core/tournament.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from 'vitest';
 import { parseSettings } from './settings';
-import { lineup, liveStatLines, nextPairings, scoreTournaments, type TournamentGame, type TournamentInput } from './tournament';
+import { lineup, liveStatLines, nextPairings, pairingInputs, scoreTournaments, type TournamentGame, type TournamentInput } from './tournament';
 import type { YearStatLine } from './year';
 
 // Fixed points (upset_k 0: win +3, loss −1), 1 point per goal, no tournament doubling: easy arithmetic.
@@ -261,6 +261,11 @@ describe('nextPairings', () => {
     expect(joined.flat().filter((x) => x !== null).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
   });
 
+  it('exposes the standings order and meetings it pairs from', () => {
+    // m1 (5 goals) and m4 (4) won game 1; m2 and m3 lost on 1 goal each, so id breaks the tie.
+    expect(pairingInputs(four())).toEqual({ order: ['m1', 'm4', 'm2', 'm3'], meetings: { 'm1|m2': 1, 'm3|m4': 1 } });
+  });
+
   it('ignores pairings of a game that never started', () => {
     const ghost = game(2, 'S1', { sessionId: null, startedAt: null, finishedAt: null });
     const f = four();
```

The new data-layer test (`src/app/lib/tournament.test.ts`):

`src/app/lib/tournament.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TournamentResult } from '../../core/tournament';
import { buildLeagueTournament, checkPairing, fetchAll, mergeRanks, toTournamentInput, type TournamentRows } from './tournament';

const T = '2026-11-07T14:00:00+00:00';
const stage = { id: 'S1', name: 'Fall beta', starts_on: '2026-10-19', bid_close_at: '2026-11-03T00:00:00+00:00',
  auction_seed: null, auction_run_at: '2026-11-04T00:00:00+00:00' };
const rows: TournamentRows = {
  settings: {},
  stages: [stage],
  games: [{ id: 'g1', stage_id: 'S1', number: 1, session_id: 'p1', started_at: T, finished_at: '2026-11-07T15:00:00+00:00' },
    { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null }],
  pairings: [{ game_id: 'g1', home: 'm1', away: 'm2' }, { game_id: 'g2', home: 'm1', away: 'm2' }],
  members: [{ id: 'm1', team_name: 'Zeal', created_at: '2026-10-01T00:00:00+00:00' },
    { id: 'm2', team_name: 'Flow', created_at: '2026-10-01T00:00:00+00:00' }],
  slots: [{ stage_id: 'S1', membership_id: 'm1', athlete_id: 'a1', price: 10, bench: false },
    { stage_id: 'S1', membership_id: 'm2', athlete_id: 'b1', price: 5, bench: false }],
  picks: [{ stage_id: 'S1', game_number: 1, membership_id: 'm1', athlete_id: 'a1' }],
  swaps: [],
  sessions: [{ id: 'p1', verified_at: '2026-11-07T20:00:00+00:00' }],
  lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 1 }, points_played: 7 }],
  taps: [],
  injuries: [
    { athlete_id: 'b1', confirmed_at: '2026-10-10T00:00:00+00:00', cleared_at: '2026-10-12T00:00:00+00:00' },
    { athlete_id: 'b1', confirmed_at: null, cleared_at: null },
    { athlete_id: 'other-season', confirmed_at: '2026-10-10T00:00:00+00:00', cleared_at: null },
  ],
  athletes: [{ id: 'a1', name: 'Jordan' }, { id: 'b1', name: 'Sam' }],
};

describe('toTournamentInput', () => {
  it('maps snake_case rows to the core input, keeping confirmed injuries of this season only', () => {
    const input = toTournamentInput(rows, 123);
    expect(input.now).toBe(123);
    expect(input.games[0]).toEqual({ id: 'g1', stageId: 'S1', number: 1, sessionId: 'p1', startedAt: T,
      finishedAt: '2026-11-07T15:00:00+00:00' });
    expect(input.picks).toEqual([{ stageId: 'S1', number: 1, membershipId: 'm1', athleteId: 'a1' }]);
    expect(input.slots[0]).toEqual({ stageId: 'S1', membershipId: 'm1', athleteId: 'a1', price: 10, bench: false });
    expect(input.statLines).toEqual([{ sessionId: 'p1', athleteId: 'a1', stats: { goal: 1 }, pointsPlayed: 7 }]);
    expect(input.injuries).toEqual([{ athleteId: 'b1', confirmedAt: '2026-10-10T00:00:00+00:00', clearedAt: '2026-10-12T00:00:00+00:00' }]);
    expect(input.currentStageId).toBe('S1');
  });

  it('stands live taps in for an unverified session', () => {
    const tap = (id: string, stat: string) =>
      ({ id, session_id: 'p1', athlete_id: 'b1', stat, keeper_id: 'k', tapped_at: '2026-11-07T14:10:00+00:00', undoes: null });
    const input = toTournamentInput({ ...rows, sessions: [{ id: 'p1', verified_at: null }], lines: [],
      taps: [tap('t1', 'goal'), tap('t2', 'block')] }, 123);
    expect(input.statLines).toEqual([{ sessionId: 'p1', athleteId: 'b1', stats: { goal: 1, block: 1 }, pointsPlayed: 0 }]);
  });

  it('has no current stage while the newest auction has not run', () => {
    const next = { ...stage, id: 'S2', starts_on: '2026-11-20', bid_close_at: '2026-11-25T00:00:00+00:00', auction_run_at: null };
    expect(toTournamentInput({ ...rows, stages: [stage, next] }, 123).currentStageId).toBeNull();
  });
});

describe('buildLeagueTournament', () => {
  it('scores the year and carries names for the UI', () => {
    const y = buildLeagueTournament(rows, Date.parse('2027-01-01T00:00:00Z'));
    expect(y.result.games.map((g) => g.status)).toEqual(['final', 'upcoming']);
    // Tournament ×2: goal 3 × 2 = 6. m2 never picked, so b1 played for them (and scored 0).
    const [m] = y.result.games[0].matchups;
    expect(m.away).toMatchObject({ membershipId: 'm2', picked: null, athleteId: 'b1', notice: 'missed', score: 0 });
    expect(y.result.standings[0]).toMatchObject({ membershipId: 'm1', wins: 1, place: 1 });
    expect(y.result.next).toMatchObject({ stageId: 'S1', number: 2 });
    expect(y.team.get('m1')).toBe('Zeal');
    expect(y.athlete.get('b1')).toBe('Sam');
    expect(y.injured.size).toBe(0);
  });
});

describe('checkPairing', () => {
  const provisional = [{ league_id: 'L', order: ['m1', 'm2', 'm3', 'm4'], meetings: { 'm1|m2': 1, 'm3|m4': 1 } }];
  it('matches the Swiss re-run, whatever order jsonb gave the keys', () => {
    // Avoiding the rematches: 1v3, 2v4.
    const pairings = [{ away: 'm3', home: 'm1', league_id: 'L' }, { away: 'm4', home: 'm2', league_id: 'L' }];
    expect(checkPairing({ pairings, provisional })).toBe(true);
  });
  it('flags a pairing that is not the Swiss one', () => {
    const pairings = [{ league_id: 'L', home: 'm1', away: 'm4' }, { league_id: 'L', home: 'm2', away: 'm3' }];
    expect(checkPairing({ pairings, provisional })).toBe(false);
    expect(checkPairing({ pairings, provisional: {} as never })).toBe(false); // not what a finish saves
  });
});

describe('mergeRanks', () => {
  const game = (id: string, stageId: string, status: string) => ({ game: { id, stageId }, status, matchups: [] });
  it('takes ranks and counts unfinished games of other stages once', () => {
    const r = (games: unknown[]) => ({ standings: [{ membershipId: 'm1', rank: 2 }], games }) as unknown as TournamentResult;
    const out = mergeRanks([
      r([game('g1', 'S1', 'pending'), game('g2', 'S1', 'void'), game('g3', 'S2', 'live')]),
      r([game('g1', 'S1', 'pending'), game('g4', 'S1', 'upcoming'), game('g5', 'S1', 'final')]),
    ], 'S2');
    expect(out).toEqual({ ranks: { m1: 2 }, unsettled: 1 });
  });
});

describe('fetchAll', () => {
  it('keeps paging past the 1000-row cap so late-season stat lines are never dropped', async () => {
    const all = Array.from({ length: 2345 }, (_, i) => i);
    const asked: [number, number][] = [];
    const got = await fetchAll((from, to) => {
      asked.push([from, to]);
      return Promise.resolve({ data: all.slice(from, to + 1), error: null });
    });
    expect(got).toEqual(all);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});
```

The error-message gate (every code `0012` raises has plain language):

```diff
diff --git a/src/app/lib/errors.test.ts b/src/app/lib/errors.test.ts
index 2d6df47..ec16f7f 100644
--- a/src/app/lib/errors.test.ts
+++ b/src/app/lib/errors.test.ts
@@ -23,6 +23,13 @@ describe('errorMessage', () => {
     expect(errorMessage({ message: 'NOT_ENOUGH_ATHLETES', details: 'League A' })).toMatch(/^League A has more roster spots/);
     expect(errorMessage({ message: 'NOT_ENOUGH_ATHLETES' })).toMatch(/^A league has more roster spots/);
   });
+  it('has plain language for every code the tournament migration raises', async () => {
+    const { readFileSync } = await import('node:fs');
+    const sql = readFileSync(new URL('../../../supabase/migrations/0012_tournament.sql', import.meta.url), 'utf8');
+    const codes = [...new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]))];
+    expect(codes.length).toBeGreaterThan(10);
+    expect(codes.filter((c) => errorMessage({ message: c }).startsWith('Something went wrong'))).toEqual([]);
+  });
   it('falls back to the raw message', () => {
     expect(errorMessage({ message: 'socket hang up' })).toBe('Something went wrong: socket hang up');
     expect(errorMessage('boom')).toBe('Something went wrong: boom');
```

The DB gaps (the next game's pick stays sealed while the current game is live; `set_game_pick`'s audit row has no
athlete; NOT_FOUND for every RPC; a deleted athlete's bench swap cascades):

```diff
diff --git a/tests/db/rpc-tournament.test.ts b/tests/db/rpc-tournament.test.ts
index 67f1a16..3f8aa44 100644
--- a/tests/db/rpc-tournament.test.ts
+++ b/tests/db/rpc-tournament.test.ts
@@ -171,6 +171,35 @@ describe('set_game_pick', () => {
     const stranger = await createUser(f.db, 'stranger@x.test');
     expect(await visible(stranger)).toEqual([]);
   });
+
+  it("keeps the next game's pick sealed while the current game is live", async () => {
+    const g1 = await open();
+    await setPick(alice, aliceM, 1, f.athletes[0]);
+    await start(g1);
+    await setPick(alice, aliceM, 2, f.athletes[1]);
+    const seen = await as(f.db, bob, async (tx) => (await tx.query<{ game_number: number }>(
+      'select game_number from public.game_picks where membership_id = $1 order by game_number', [aliceM])).rows);
+    expect(seen).toEqual([{ game_number: 1 }]);
+  });
+
+  it('audits a pick without its athlete', async () => {
+    await setPick(alice, aliceM, 1, f.athletes[0]);
+    expect(JSON.stringify(await audit('set_game_pick'))).not.toContain(f.athletes[0]);
+  });
+});
+
+describe('NOT_FOUND', () => {
+  it('names a missing game or stage', async () => {
+    const nope = crypto.randomUUID();
+    await expect(start(nope)).rejects.toThrow('NOT_FOUND');
+    await expect(finish(nope)).rejects.toThrow('NOT_FOUND');
+    const calls: [string, Record<string, unknown>][] = [
+      ['set_game_pick', { p_membership: aliceM, p_stage: nope, p_number: 1, p_athlete: f.athletes[0] }],
+      ['set_bench', { p_membership: aliceM, p_stage: nope, p_athletes: `{${f.athletes[0]}}` }],
+      ['swap_bench', { p_membership: aliceM, p_stage: nope, p_out: f.athletes[0], p_in: f.athletes[3] }],
+    ];
+    for (const [fn, args] of calls) await expect(as(f.db, alice, (tx) => rpc(tx, fn, args)), fn).rejects.toThrow('NOT_FOUND');
+  });
 });
 
 describe('set_bench', () => {
@@ -218,5 +247,10 @@ describe('deletes', () => {
     await setPick(alice, aliceM, 1, f.athletes[0]);
     await f.db.query('delete from public.athletes where id = $1', [f.athletes[0]]);
     expect((await f.db.query('select 1 from public.game_picks')).rows).toEqual([]);
+    await start(await open());
+    await injure(f, f.athletes[1]);
+    await swap(alice, aliceM, f.athletes[1], f.athletes[3]);
+    await f.db.query('delete from public.athletes where id = $1', [f.athletes[3]]);
+    expect((await f.db.query('select 1 from public.bench_swaps')).rows).toEqual([]);
   });
 });
```

- [ ] **Step 2: Run them to see the app/core ones fail**

Run: `npx vitest run src/core/tournament.test.ts src/app/lib/tournament.test.ts src/app/lib/errors.test.ts`
Expected: FAIL — `pairingInputs` is not exported, `./tournament` (app lib) doesn't exist, and 13 tournament codes
have no message. (`tests/db/rpc-tournament.test.ts` already passes: it pins database behaviour 0012 has.)

- [ ] **Step 3: Implement.** Copy the core change, the data layer and the messages:

```bash
git checkout t3-verified-draft -- src/core/tournament.ts src/app/lib/tournament.ts src/app/lib/errors.ts
```

```diff
diff --git a/src/core/tournament.ts b/src/core/tournament.ts
index 697e102..4ac93ce 100644
--- a/src/core/tournament.ts
+++ b/src/core/tournament.ts
@@ -273,6 +273,12 @@ export function liveStatLines(sessionId: string, taps: Tap[], s: SeasonSettings)
  * finished is still live (before `finish_game`), so that game counts too.
  */
 export function nextPairings(input: TournamentInput): Pairing[] {
+  const { order, meetings } = pairingInputs(input);
+  return swissPairings(order, meetings);
+}
+
+/** What `nextPairings` feeds `swissPairings`: saved with the pairing so staff can re-run it (spec §7). */
+export function pairingInputs(input: TournamentInput): { order: string[]; meetings: Record<string, number> } {
   const r = scoreTournaments(input, { provisional: true });
   const present = new Set(input.members.filter((m) => ms(m.createdAt) <= input.now).map((m) => m.id));
   const order = r.standings.filter((x) => present.has(x.membershipId))
@@ -285,5 +291,5 @@ export function nextPairings(input: TournamentInput): Pairing[] {
     const k = meetingKey(p.home, p.away);
     meetings[k] = (meetings[k] ?? 0) + 1;
   }
-  return swissPairings(order, meetings);
+  return { order, meetings };
 }
```

`src/app/lib/tournament.ts` (new). Note `toTournamentInput`'s `currentStageId` (the stage whose auction opened most
recently, once it has run), live taps standing in for unverified sessions, and `checkPairing` comparing as strings
because jsonb reorders object keys:

`src/app/lib/tournament.ts`:

```ts
import { parseSettings, type SeasonSettings } from '../../core/settings';
import { swissPairings } from '../../core/swiss';
import {
  liveStatLines, pairingInputs, scoreTournaments, type TournamentInput, type TournamentResult,
} from '../../core/tournament';
import { rowToTap, type StatTapRow } from '../tally/queue';
import { AUCTION_STAGE_COLUMNS, pickAuctionStage, type AuctionStage } from './auction';
import { supabase } from './supabase';

export interface GameRow {
  id: string; stage_id: string; number: number; session_id: string | null; started_at: string | null; finished_at: string | null;
}
export const GAME_COLUMNS = 'id, stage_id, number, session_id, started_at, finished_at';
/** One pairing as open_tournament / finish_game take it. */
export interface GamePairing { league_id: string; home: string; away: string | null }
/** What one league's pairing was computed from (saved in the finish_game audit row). */
export interface LeaguePairingInput { league_id: string; order: string[]; meetings: Record<string, number> }
interface LineRow { session_id: string; athlete_id: string; stats: Record<string, number>; points_played: number }
interface InjuryRow { athlete_id: string; confirmed_at: string | null; cleared_at: string | null }

/** Rows as PostgREST returns them, for one league of one season. */
export interface TournamentRows {
  settings: unknown;
  stages: AuctionStage[];
  games: GameRow[];
  /** This league's pairings only. */
  pairings: { game_id: string; home: string; away: string | null }[];
  members: { id: string; team_name: string; created_at: string }[];
  slots: { stage_id: string; membership_id: string; athlete_id: string; price: number; bench: boolean }[];
  picks: { stage_id: string; game_number: number; membership_id: string; athlete_id: string }[];
  swaps: { stage_id: string; membership_id: string; out_athlete: string; in_athlete: string; from_game: number }[];
  /** Every session a game links to: a game whose session is missing is void. */
  sessions: { id: string; verified_at: string | null }[];
  lines: LineRow[];
  /** Taps of unverified game sessions (staff only), for provisional pairing. Empty otherwise. */
  taps: (StatTapRow & { session_id: string })[];
  injuries: InjuryRow[];
  athletes: { id: string; name: string }[];
}

export function toTournamentInput(rows: TournamentRows, now: number): TournamentInput {
  const settings = parseSettings(rows.settings);
  const athletes = new Set(rows.athletes.map((a) => a.id));
  // Unverified sessions have no stat lines yet: their live taps stand in (only staff load them).
  const live = rows.sessions.filter((s) => s.verified_at === null).flatMap((s) =>
    liveStatLines(s.id, rows.taps.filter((t) => t.session_id === s.id).map(rowToTap), settings));
  const current = pickAuctionStage(rows.stages);
  return {
    settings,
    now,
    games: rows.games.map((g) => ({
      id: g.id, stageId: g.stage_id, number: g.number, sessionId: g.session_id, startedAt: g.started_at, finishedAt: g.finished_at,
    })),
    pairings: rows.pairings.map((p) => ({ gameId: p.game_id, home: p.home, away: p.away })),
    members: rows.members.map((m) => ({ id: m.id, createdAt: m.created_at })),
    slots: rows.slots.map((x) => ({ stageId: x.stage_id, membershipId: x.membership_id, athleteId: x.athlete_id, price: x.price, bench: x.bench })),
    picks: rows.picks.map((p) => ({ stageId: p.stage_id, number: p.game_number, membershipId: p.membership_id, athleteId: p.athlete_id })),
    swaps: rows.swaps.map((w) => ({
      stageId: w.stage_id, membershipId: w.membership_id, outAthlete: w.out_athlete, inAthlete: w.in_athlete, fromGame: w.from_game,
    })),
    sessions: rows.sessions.map((s) => ({ id: s.id, verifiedAt: s.verified_at })),
    statLines: [
      ...rows.lines.map((l) => ({ sessionId: l.session_id, athleteId: l.athlete_id, stats: l.stats, pointsPlayed: l.points_played })),
      ...live,
    ],
    // Injuries have no season column: keep this season's athletes, confirmed reports only.
    injuries: rows.injuries.filter((i) => i.confirmed_at !== null && athletes.has(i.athlete_id))
      .map((i) => ({ athleteId: i.athlete_id, confirmedAt: i.confirmed_at!, clearedAt: i.cleared_at })),
    // Picks and lineups are for the stage whose auction has run; between tournaments (next auction open) there's none.
    currentStageId: current?.auction_run_at ? current.id : null,
  };
}

export interface LeagueTournament {
  settings: SeasonSettings;
  input: TournamentInput;
  result: TournamentResult;
  team: Map<string, string>;
  athlete: Map<string, string>;
  stage: Map<string, string>;
  /** Athletes with a confirmed injury that hasn't cleared. */
  injured: Set<string>;
}

export function buildLeagueTournament(rows: TournamentRows, now = Date.now()): LeagueTournament {
  const input = toTournamentInput(rows, now);
  return {
    settings: input.settings,
    input,
    result: scoreTournaments(input),
    team: new Map(rows.members.map((m) => [m.id, m.team_name])),
    athlete: new Map(rows.athletes.map((a) => [a.id, a.name])),
    stage: new Map(rows.stages.map((x) => [x.id, x.name])),
    injured: new Set(input.injuries.filter((i) => i.clearedAt === null || Date.parse(i.clearedAt) > now).map((i) => i.athleteId)),
  };
}

const PAGE = 1000; // PostgREST's default max rows

/** Every row, a page at a time. `page` must order by a unique key so pages don't overlap. */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}

/** A query's rows, or none when `q` is null (an `.in()` over an empty list). */
async function rowsOf<T>(q: PromiseLike<{ data: unknown; error: unknown }> | null): Promise<T[]> {
  if (!q) return [];
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

/**
 * Every row the league's year needs; RLS hides other teams' picks until each game starts. `taps` (staff only) adds the
 * live taps of unverified game sessions, for provisional pairing.
 */
export async function loadLeagueRows(seasonId: string, leagueId: string, { taps = false } = {}): Promise<TournamentRows> {
  const sb = supabase!;
  const [season, stages, members, slots, picks, injuries, athletes] = await Promise.all([
    rowsOf<{ settings: unknown }>(sb.from('seasons').select('settings').eq('id', seasonId)),
    rowsOf<AuctionStage>(sb.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId)),
    rowsOf<TournamentRows['members'][number]>(sb.from('memberships').select('id, team_name, created_at').eq('league_id', leagueId)),
    rowsOf<TournamentRows['slots'][number]>(sb.from('roster_slots').select('stage_id, membership_id, athlete_id, price, bench').eq('league_id', leagueId)),
    // ponytail: unpaged, fine below 1000 picks a league-year (6 teams × ~20 games).
    rowsOf<TournamentRows['picks'][number]>(sb.from('game_picks').select('stage_id, game_number, membership_id, athlete_id').eq('league_id', leagueId)),
    rowsOf<InjuryRow>(sb.from('injuries').select('athlete_id, confirmed_at, cleared_at').not('confirmed_at', 'is', null)),
    rowsOf<TournamentRows['athletes'][number]>(sb.from('athletes').select('id, name').eq('season_id', seasonId)),
  ]);
  if (season.length === 0) throw new Error('NOT_FOUND');
  const stageIds = stages.map((x) => x.id);
  const games = await rowsOf<GameRow>(stageIds.length ? sb.from('games').select(GAME_COLUMNS).in('stage_id', stageIds) : null);
  const gameIds = games.map((g) => g.id);
  const sessionIds = games.flatMap((g) => (g.session_id ? [g.session_id] : []));
  const [pairings, swaps, sessions] = await Promise.all([
    rowsOf<TournamentRows['pairings'][number]>(gameIds.length
      ? sb.from('game_pairings').select('game_id, home, away').eq('league_id', leagueId).in('game_id', gameIds) : null),
    rowsOf<TournamentRows['swaps'][number]>(stageIds.length
      ? sb.from('bench_swaps').select('stage_id, membership_id, out_athlete, in_athlete, from_game').in('stage_id', stageIds) : null),
    rowsOf<TournamentRows['sessions'][number]>(sessionIds.length ? sb.from('sessions').select('id, verified_at').in('id', sessionIds) : null),
  ]);
  const open = sessions.filter((s) => s.verified_at === null).map((s) => s.id);
  const [lines, tapRows] = await Promise.all([
    sessionIds.length
      ? fetchAll<LineRow>((from, to) => sb.from('stat_lines').select('session_id, athlete_id, stats, points_played')
        .in('session_id', sessionIds).order('session_id').order('athlete_id').range(from, to))
      : [],
    taps && open.length
      ? fetchAll<TournamentRows['taps'][number]>((from, to) => sb.from('stat_taps')
        .select('id, session_id, athlete_id, stat, keeper_id, tapped_at, undoes').in('session_id', open).order('id').range(from, to))
      : [],
  ]);
  return {
    settings: season[0].settings, stages, games, pairings, members, slots, picks, swaps, sessions, lines, taps: tapRows,
    injuries, athletes,
  };
}

export const loadLeagueTournament = async (seasonId: string, leagueId: string) =>
  buildLeagueTournament(await loadLeagueRows(seasonId, leagueId));

const leaguesOf = (seasonId: string) =>
  rowsOf<{ id: string; name: string }>(supabase!.from('leagues').select('id, name').eq('season_id', seasonId).order('name'));

/** The Swiss pairing of one league's inputs, in the shape the RPCs take. */
export const toPairings = (p: LeaguePairingInput): GamePairing[] =>
  swissPairings(p.order, p.meetings).map(([home, away]) => ({ league_id: p.league_id, home, away }));

/**
 * The next game's pairings for every league of the season, from provisional standings (live taps where a session
 * isn't verified, so the caller must be staff), with the inputs each was computed from.
 */
export async function seasonPairings(seasonId: string, now = Date.now()): Promise<{
  pairings: GamePairing[]; provisional: LeaguePairingInput[]; team: Map<string, string>; league: Map<string, string>;
}> {
  const leagues = await leaguesOf(seasonId);
  const loaded = await Promise.all(leagues.map(async (l) => ({ l, rows: await loadLeagueRows(seasonId, l.id, { taps: true }) })));
  const provisional = loaded.map(({ l, rows }) => ({ league_id: l.id, ...pairingInputs(toTournamentInput(rows, now)) }));
  return {
    pairings: provisional.flatMap(toPairings),
    provisional,
    team: new Map(loaded.flatMap(({ rows }) => rows.members.map((m) => [m.id, m.team_name] as const))),
    league: new Map(leagues.map((l) => [l.id, l.name])),
  };
}

/** The tally's game: the newest game of the stage whose auction has run (null before its tournament opens). */
export async function loadCurrentGame(seasonId: string): Promise<{ stage: AuctionStage; game: GameRow } | null> {
  const stage = pickAuctionStage(await rowsOf<AuctionStage>(supabase!.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId)));
  if (!stage?.auction_run_at) return null;
  const [game] = await rowsOf<GameRow>(supabase!.from('games').select(GAME_COLUMNS).eq('stage_id', stage.id)
    .order('number', { ascending: false }).limit(1));
  return game ? { stage, game } : null;
}

/**
 * Staff "Check pairing" (spec §7): does re-running Swiss on the saved inputs give the saved pairings? It catches a
 * pairing that wasn't Swiss; it can't catch made-up standings (those are in the audit row to eyeball).
 */
export function checkPairing(details: { pairings: GamePairing[]; provisional: LeaguePairingInput[] }): boolean {
  if (!Array.isArray(details.pairings) || !Array.isArray(details.provisional)) return false;
  // jsonb reorders object keys, so compare as plain strings.
  const key = (p: GamePairing) => `${p.league_id}:${p.home}:${p.away ?? ''}`;
  return details.provisional.flatMap(toPairings).map(key).join() === details.pairings.map(key).join();
}

/** 'Zeal vs Flow · Money has a bye' */
export const describePairings = (pairings: GamePairing[], team: Map<string, string>) => pairings
  .map((p) => (p.away === null ? `${team.get(p.home) ?? 'A team'} has a bye` : `${team.get(p.home) ?? 'A team'} vs ${team.get(p.away) ?? 'A team'}`))
  .join(' · ');

/**
 * Merge standings from all leagues. Pure function for testability. Unsettled: games of other stages that started
 * and aren't final yet (void and never-started games don't count).
 */
export function mergeRanks(results: TournamentResult[], stageId: string): { ranks: Record<string, number>; unsettled: number } {
  const ranks: Record<string, number> = {};
  const unsettled = new Set<string>();
  for (const result of results) {
    for (const row of result.standings) ranks[row.membershipId] = row.rank;
    for (const g of result.games) {
      if (g.game.stageId !== stageId && (g.status === 'live' || g.status === 'pending')) unsettled.add(g.game.id);
    }
  }
  return { ranks, unsettled: unsettled.size };
}

/** The allowance input for every league of the season: {membership: rank}, and how many games aren't final yet. */
export async function seasonRanks(seasonId: string, stageId: string): Promise<{ ranks: Record<string, number>; unsettled: number }> {
  const years = await Promise.all((await leaguesOf(seasonId)).map((l) => loadLeagueTournament(seasonId, l.id)));
  return mergeRanks(years.map((y) => y.result), stageId);
}
```

```diff
diff --git a/src/app/lib/errors.ts b/src/app/lib/errors.ts
index 2102ce6..a3af436 100644
--- a/src/app/lib/errors.ts
+++ b/src/app/lib/errors.ts
@@ -52,7 +52,20 @@ const MESSAGES: Record<string, string> = {
   NOT_MEMBER: "That isn't your team.",
   WEEKS_HAVE_PICKS: "Managers have already picked for this stage's weeks, so they can't be rebuilt. Change a single week's lock instead.",
   INVALID_LOCK_TIME: 'Pick a lock time before the week ends.',
-  PICK_LOCKED: 'Picks for this week are locked.',
+  PICK_LOCKED: 'That game has started, so its picks are locked.',
+  NOT_NEXT_GAME: 'You can only pick for the next game.',
+  GAMES_EXIST: "This stage's tournament is already open.",
+  GAME_STARTED: 'Another keeper already started this game.',
+  GAME_NOT_LIVE: 'This game is already finished (or not started yet).',
+  PREVIOUS_GAME_LIVE: 'Finish the game before this one first.',
+  PAIRINGS_INVALID: "Those pairings don't include every team exactly once. Reload and try again.",
+  TOURNAMENT_STARTED: 'The tournament has started, so the bench is set. Use Swap in if an active player is injured.',
+  TOURNAMENT_NOT_STARTED: "The tournament hasn't started yet. Change your bench instead.",
+  BENCH_SIZE: "That's the wrong number of bench players.",
+  NOT_ACTIVE: "That player isn't one of your active players.",
+  NOT_ON_BENCH: "That player isn't on your bench.",
+  NOT_INJURED: 'You can swap only for a player with a confirmed injury.',
+  SWAP_USED: "You've already used your bench swap this stage.",
   NOT_ON_ROSTER: "That player isn't on your roster this season.",
   STANDINGS_MISSING: "The standings didn't include every team. Reload and try again.",
   NOT_ENOUGH_ATHLETES: '{detail} has more roster spots than healthy opted-in players. Opt in more players or lower the roster size.',
```

Then edit `src/app/lib/rpc.ts` by hand (the weekly wrappers stay until Task 4). Add the type import under the
`supabase` import:

```ts
import type { GamePairing, LeaguePairingInput } from './tournament';
```

and these entries after `runAuction`:

```ts
  openTournament: (stageId: string, pairings: GamePairing[]) =>
    call<string>('open_tournament', { p_stage: stageId, p_pairings: pairings }),
  startGame: (gameId: string) => call<string>('start_game', { p_game: gameId }),
  finishGame: (gameId: string, pairings: GamePairing[], provisional: LeaguePairingInput[]) =>
    call<string>('finish_game', { p_game: gameId, p_pairings: pairings, p_provisional: provisional }),
  setGamePick: (membershipId: string, stageId: string, number: number, athleteId: string | null) =>
    call<void>('set_game_pick', { p_membership: membershipId, p_stage: stageId, p_number: number, p_athlete: athleteId }),
  setBench: (membershipId: string, stageId: string, athleteIds: string[]) =>
    call<void>('set_bench', { p_membership: membershipId, p_stage: stageId, p_athletes: athleteIds }),
  swapBench: (membershipId: string, stageId: string, outAthlete: string, inAthlete: string) =>
    call<void>('swap_bench', { p_membership: membershipId, p_stage: stageId, p_out: outAthlete, p_in: inAthlete }),
```

- [ ] **Step 4: Run the tests and checks**

Run: `npx vitest run src && npx tsc -b && npx eslint .` then, on its own, `npx vitest run tests/db/rpc-tournament.test.ts`
Expected: all pass (rpc-tournament: 19 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/tournament.ts src/core/tournament.test.ts src/app/lib/tournament.ts src/app/lib/tournament.test.ts src/app/lib/rpc.ts src/app/lib/errors.ts src/app/lib/errors.test.ts tests/db/rpc-tournament.test.ts
git commit -m "feat(app): tournament data layer, RPC wrappers and messages (tournament mode T3)"
```

---

### Task 2: League tab — the Tournament card

**Files:**
- Create: `src/app/pages/TournamentCard.tsx`, `src/app/pages/TournamentCard.test.tsx`
- Modify: `src/app/pages/HomePage.tsx` (render `TournamentCard` instead of `WeeklyCard`), `src/app/styles.css`
  (one comment)

**Interfaces:**
- Consumes: `loadLeagueTournament`, `LeagueTournament` (Task 1); `api.setGamePick`, `api.setBench`,
  `api.swapBench` (Task 1); core types `GameOutcome`, `NextGame`, `TournamentSide`.
- Produces: `TournamentCard({ membershipId, leagueId, seasonId })`. `WeeklyCard.tsx` stays on disk, unused, until
  Task 4 deletes it.

Layout (spec §6): one card, "Tournament". (1) While a game the team plays in is live: "Game N · stage", Playing
now, both starters, the notice if the pick was replaced. (2) The next game (`result.next`): opponent, or "set when
game N−1 finishes" / "when the tournament opens", or a bye; the active players sorted by name with **Tired ×0.5**
(`pill warn`) and **Injured** (`pill bad`) badges and Pick / "Your pick ✓ · Clear"; before game 1 starts a
**Bench** button per active player; the bench players greyed (`li.used`) with **Swap in for X** once the
tournament has started, an active player is injured and the swap is unused (confirm first). (3) Standings.
(4) Games played (pending, final, void), newest first, each a `<details>` with per-matchup detail: stats line,
"Game score × 0.5 tired × 0.9 earlier seasons = score (±delta)".

- [ ] **Step 1: Write the failing test** (`git checkout t3-verified-draft -- src/app/pages/TournamentCard.test.tsx`):

`src/app/pages/TournamentCard.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/rpc';
import { buildLeagueTournament, type TournamentRows } from '../lib/tournament';
import { TournamentCard } from './TournamentCard';

const rows = vi.hoisted(() => ({ current: null as unknown as TournamentRows }));
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadLeagueTournament: () => Promise.resolve(buildLeagueTournament(rows.current, Date.parse('2026-11-07T16:30:00Z'))),
}));
vi.mock('../lib/rpc', () => ({ api: { setGamePick: vi.fn(), setBench: vi.fn(), swapBench: vi.fn() } }));

const NAMES: Record<string, string> = { a1: 'Ash', a2: 'Avery', a3: 'Alex', a4: 'Arlo', b1: 'Bea', b2: 'Quinn', b3: 'Blake', b4: 'Bryn' };
const roster = (m: string, ids: string[]) =>
  ids.map((athlete_id, i) => ({ stage_id: 'S1', membership_id: m, athlete_id, price: [30, 20, 10, 5][i], bench: false }));
/** Two teams before the tournament opens: a4 and b4 are the cheapest, so they're benched by default. */
const base = (): TournamentRows => ({
  settings: {},
  stages: [{ id: 'S1', name: 'Fall beta', starts_on: '2026-10-19', bid_close_at: '2026-11-03T00:00:00Z', auction_seed: null,
    auction_run_at: '2026-11-04T00:00:00Z' }],
  games: [],
  pairings: [],
  members: [{ id: 'm1', team_name: 'Zeal', created_at: '2026-10-01T00:00:00Z' }, { id: 'm2', team_name: 'Flow', created_at: '2026-10-01T00:00:00Z' }],
  slots: [...roster('m1', ['a1', 'a2', 'a3', 'a4']), ...roster('m2', ['b1', 'b2', 'b3', 'b4'])],
  picks: [],
  swaps: [],
  sessions: [],
  lines: [],
  taps: [],
  injuries: [],
  athletes: Object.entries(NAMES).map(([id, name]) => ({ id, name })),
});
/** Game 1 played (finished, stats not verified): m1 started a1, m2 b1. Game 2 is paired and not started. */
const afterGame1 = (): TournamentRows => ({
  ...base(),
  games: [{ id: 'g1', stage_id: 'S1', number: 1, session_id: 'p1', started_at: '2026-11-07T14:00:00Z', finished_at: '2026-11-07T15:00:00Z' },
    { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null }],
  pairings: [{ game_id: 'g1', home: 'm1', away: 'm2' }, { game_id: 'g2', home: 'm1', away: 'm2' }],
  // RLS: the league sees game 1's picks (started); m2's game 2 pick, if any, is sealed and never arrives.
  picks: [{ stage_id: 'S1', game_number: 1, membership_id: 'm1', athlete_id: 'a1' },
    { stage_id: 'S1', game_number: 1, membership_id: 'm2', athlete_id: 'b1' }],
  sessions: [{ id: 'p1', verified_at: null }],
});

const confirm = vi.fn();
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.setGamePick).mockReset();
  vi.mocked(api.setBench).mockReset();
  vi.mocked(api.swapBench).mockReset();
  confirm.mockReset().mockReturnValue(true);
  window.confirm = confirm;
});
const show = async (r: TournamentRows) => {
  rows.current = r;
  render(<TournamentCard membershipId="m1" leagueId="L" seasonId="se" />);
  await screen.findByRole('heading', { name: 'Tournament' });
};

describe('TournamentCard', () => {
  it('lets a manager pre-select game 1 and choose the bench before the tournament opens', async () => {
    await show(base());
    expect(screen.getByText(/Your opponent is set when the tournament opens/)).toBeTruthy();
    expect(screen.getByText('Arlo').parentElement?.textContent).toContain('Bench');
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0]); // Alex, first by name
    await waitFor(() => expect(api.setGamePick).toHaveBeenCalledWith('m1', 'S1', 1, 'a3'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Bench' })[0]);
    await waitFor(() => expect(api.setBench).toHaveBeenCalledWith('m1', 'S1', ['a3']));
  });

  it("shows the next opponent, the tiredness of last game's starter, and never the opponent's sealed pick", async () => {
    await show(afterGame1());
    expect(screen.getByRole('heading', { name: 'Game 2 · Fall beta' })).toBeTruthy();
    expect(screen.getByText(/Their pick stays hidden until the game starts/).textContent).toContain('Flow');
    expect(screen.getByText('Ash').parentElement?.textContent).toContain('Tired ×0.5');
    // Quinn is who the scorer would auto-pick for Flow: shown nowhere until game 2 starts.
    expect(document.body.textContent).not.toContain('Quinn');
    expect(screen.getByText(/Waiting on stats/)).toBeTruthy(); // game 1, finished but not verified
    expect(screen.queryByRole('button', { name: 'Bench' })).toBeNull(); // the tournament has started
  });

  it('offers the bench swap for an injured active player once the tournament has started', async () => {
    await show({ ...afterGame1(), injuries: [{ athlete_id: 'a2', confirmed_at: '2026-11-07T14:30:00Z', cleared_at: null }] });
    fireEvent.click(screen.getByRole('button', { name: 'Swap in for Avery' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.swapBench).toHaveBeenCalledWith('m1', 'S1', 'a2', 'a4'));
  });

  it('marks a game whose tally was deleted as void', async () => {
    const r = afterGame1();
    await show({ ...r, games: r.games.map((g) => (g.id === 'g1' ? { ...g, session_id: null } : g)), sessions: [] });
    fireEvent.click(screen.getByText(/Game 1 · Fall beta/));
    expect(screen.getByText('Void')).toBeTruthy();
    expect(screen.getByText(/tally was deleted/)).toBeTruthy();
    // A void start doesn't tire anyone.
    expect(screen.getByText('Ash').parentElement?.textContent).not.toContain('Tired');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/pages/TournamentCard.test.tsx`
Expected: FAIL — cannot resolve `./TournamentCard`.

- [ ] **Step 3: Implement** (`git checkout t3-verified-draft -- src/app/pages/TournamentCard.tsx src/app/pages/HomePage.tsx src/app/styles.css`):

`src/app/pages/TournamentCard.tsx`:

```tsx
import { useState } from 'react';
import { rawScore } from '../../core/scoring';
import type { GameOutcome, NextGame, TournamentSide } from '../../core/tournament';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { statLabel } from '../lib/stats';
import { loadLeagueTournament, type LeagueTournament } from '../lib/tournament';
import { useLoad } from '../lib/useLoad';

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(Math.abs(n))}`;
/** An athlete's name, or `none` when nobody plays. */
const athleteName = (y: LeagueTournament, id: string | null, none = 'nobody') => (id ? y.athlete.get(id) ?? 'A player' : none);
const sides = (g: GameOutcome) => g.matchups.flatMap((m) => [m.home, m.away]);
const opponentIn = (g: GameOutcome, membershipId: string): TournamentSide | null | undefined => {
  const m = g.matchups.find((x) => x.home.membershipId === membershipId || x.away?.membershipId === membershipId);
  if (!m) return undefined; // not in this game
  return m.home.membershipId === membershipId ? m.away : m.home;
};

/** Tournament play for one team: the game being played, the next game's pick, standings, and every game so far. */
export function TournamentCard({ membershipId, leagueId, seasonId }: { membershipId: string; leagueId: string; seasonId: string }) {
  const { data, error, reload } = useLoad(() => loadLeagueTournament(seasonId, leagueId), [seasonId, leagueId]);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="muted" role="status">Loading games…</p>;
  const { games, next } = data.result;
  if (games.length === 0 && next === null) return null; // no tournament yet
  const live = games.find((g) => g.status === 'live' && opponentIn(g, membershipId) !== undefined);
  const played = [...games].reverse().filter((g) => g.status === 'pending' || g.status === 'final' || g.status === 'void');

  return (
    <article className="card" aria-label="Tournament">
      <h2>Tournament</h2>
      {live && <LiveGame y={data} g={live} membershipId={membershipId} />}
      {next && <PickGame key={`${next.stageId}:${next.number}`} y={data} next={next} membershipId={membershipId} onSaved={reload} />}
      <Standings y={data} membershipId={membershipId} />
      <div className="section">
        <h3>Games</h3>
        {played.map((g) => <GameRow key={g.game.id} y={data} g={g} membershipId={membershipId} />)}
        {played.length === 0 && <p className="muted">No games played yet.</p>}
      </div>
    </article>
  );
}

function PickGame({ y, next, membershipId, onSaved }: {
  y: LeagueTournament; next: NextGame; membershipId: string; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string | null) => athleteName(y, id);
  const mine = next.sides.find((x) => x.membershipId === membershipId);
  const title = `Game ${next.number} · ${y.stage.get(next.stageId) ?? ''}`;
  if (!mine) {
    return <div className="stack"><h3>{title}</h3><p className="muted">You have no players this stage, so you sit out its games.</p></div>;
  }
  const paired = y.result.games.find((g) => g.game.stageId === next.stageId && g.game.number === next.number);
  const them = paired ? opponentIn(paired, membershipId) : undefined;
  if (paired && them === undefined) {
    return <div className="stack"><h3>{title}</h3><p className="muted">You joined after this game was paired. You'll play from the next game.</p></div>;
  }
  const started = y.input.games.some((g) => g.stageId === next.stageId && g.startedAt !== null);
  const swapUsed = y.input.swaps.some((w) => w.stageId === next.stageId && w.membershipId === membershipId);
  const injuredActive = mine.active.filter((a) => y.injured.has(a));
  const byName = (a: string, b: string) => name(a).localeCompare(name(b));

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
    onSaved(); // a refused pick usually means the game just started: show it
  }
  const choose = (athleteId: string | null) => act(() => api.setGamePick(membershipId, next.stageId, next.number, athleteId));
  // ponytail: benching rotates out the longest-benched player; with the default bench of 1 that's a plain swap.
  const bench = (athleteId: string) => act(() => api.setBench(membershipId, next.stageId, [athleteId, ...mine.bench].slice(0, mine.bench.length)));
  const swapIn = (out: string, inAthlete: string) => {
    if (!window.confirm(`Swap ${name(inAthlete)} in for ${name(out)} for the rest of this stage? You get one swap per stage.`)) return;
    void act(() => api.swapBench(membershipId, next.stageId, out, inAthlete));
  };

  return (
    <div className="stack">
      <div className="head">
        <h3>{title}</h3>
        <span className="pill info">Picks lock when the game starts</span>
      </div>
      <p>
        {them ? <>You play <strong>{y.team.get(them.membershipId)}</strong>. Their pick stays hidden until the game starts.</>
          : them === null ? 'You have a bye this game.'
            : next.number === 1 ? 'Your opponent is set when the tournament opens. You can pick now.'
              : `Your opponent is set when game ${next.number - 1} finishes. You can pick now.`}
      </p>
      {mine.notice === 'missed' && (
        <p className="notice">No pick yet. If you don't pick, {name(mine.athleteId)} plays{mine.athleteId ? '' : ' and you forfeit'}.</p>
      )}
      {mine.notice === 'injured' && (
        <p className="notice">{name(mine.picked)} is injured. When the game starts we'll play {name(mine.athleteId)} unless you change your pick.</p>
      )}
      {mine.notice === 'inactive' && (
        <p className="notice">{name(mine.picked)} is on your bench, so {name(mine.athleteId)} plays unless you change your pick.</p>
      )}
      <ul className="list">
        {[...mine.active].sort(byName).map((id) => {
          const chosen = mine.picked === id;
          const tired = mine.rest[id] < 1;
          return (
            <li key={id}>
              <span className="meta">
                <span className="title">{name(id)}</span>
                {tired && <span className="pill warn">Tired ×{fmt(mine.rest[id])}</span>}
                {y.injured.has(id) && <span className="pill bad">Injured</span>}
              </span>
              {!started && mine.bench.length > 0 && (
                <button className="secondary" disabled={busy} onClick={() => void bench(id)}>Bench</button>
              )}
              {chosen ? (
                <button className="secondary" aria-pressed="true" disabled={busy} onClick={() => void choose(null)}>
                  Your pick ✓ <span className="muted">· Clear</span>
                </button>
              ) : (
                <button disabled={busy} onClick={() => void choose(id)}>Pick</button>
              )}
            </li>
          );
        })}
        {[...mine.bench].sort(byName).map((id) => (
          <li key={id} className="used">
            <span className="meta">
              <span className="title">{name(id)}</span>
              <span className="pill">Bench</span>
              {y.injured.has(id) && <span className="pill bad">Injured</span>}
            </span>
            {started && !swapUsed && injuredActive.map((out) => (
              <button key={out} className="secondary" disabled={busy} onClick={() => swapIn(out, id)}>Swap in for {name(out)}</button>
            ))}
          </li>
        ))}
      </ul>
      <p className="muted"><small>
        {started
          ? 'Your bench player comes in only if an active player gets injured (one swap per stage).'
          : 'Choose your bench before game 1 starts. It plays only if an active player gets injured.'}
        {y.settings.tiredness_multipliers.length > 0 && <> Starting a player again soon tires them: {
          y.settings.tiredness_multipliers.map((m, i) => `×${fmt(m)} ${i === 0 ? 'the next game' : `${i + 1} games later`}`).join(', ')}.</>}
      </small></p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

function LiveGame({ y, g, membershipId }: { y: LeagueTournament; g: GameOutcome; membershipId: string }) {
  const mine = sides(g).find((x) => x?.membershipId === membershipId);
  if (!mine) return null;
  const them = opponentIn(g, membershipId);
  const name = (id: string | null) => athleteName(y, id, 'nobody (forfeit)');
  return (
    <div className="stack">
      <div className="head">
        <h3>Game {g.game.number} · {y.stage.get(g.game.stageId) ?? ''}</h3>
        <span className="pill ok">Playing now</span>
      </div>
      <p>
        {name(mine.athleteId)}
        {them ? <> vs <strong>{y.team.get(them.membershipId)}</strong>: {name(them.athleteId)}</> : ' · bye'}
      </p>
      <Notice y={y} side={mine} />
      <p className="muted">Scores appear once this game's stats lock.</p>
    </div>
  );
}

function Notice({ y, side }: { y: LeagueTournament; side: TournamentSide }) {
  const name = (id: string | null) => athleteName(y, id);
  if (!side.notice) return null;
  const who = side.athleteId ? `${name(side.athleteId)} played for you` : 'nobody was left to play (forfeit)';
  const why = { missed: "You didn't pick", injured: `${name(side.picked)} was injured`, inactive: `${name(side.picked)} was on your bench` }[side.notice];
  return <p className="notice">{why}, so {who}.</p>;
}

function Standings({ y, membershipId }: { y: LeagueTournament; membershipId: string }) {
  return (
    <div className="section">
      <h3>Standings</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Team</th><th scope="col">Place</th><th scope="col">W-L-T</th><th scope="col">Points</th></tr></thead>
          <tbody>
            {y.result.standings.map((r) => (
              <tr key={r.membershipId} aria-current={r.membershipId === membershipId ? 'true' : undefined}>
                <td>{r.membershipId === membershipId ? <strong>{y.team.get(r.membershipId)} (you)</strong> : y.team.get(r.membershipId)}</td>
                <td>{r.tied ? `T${r.place}` : r.place}</td>
                <td>{r.wins}-{r.losses}-{r.ties}</td>
                <td>{fmt(r.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STATUS: Record<GameOutcome['status'], [string, string]> = {
  upcoming: ['Next', 'pill info'],
  live: ['Playing', 'pill ok'],
  pending: ['Waiting on stats', 'pill warn'],
  final: ['Final', 'pill'],
  void: ['Void', 'pill'],
};

function GameRow({ y, g, membershipId }: { y: LeagueTournament; g: GameOutcome; membershipId: string }) {
  const mine = sides(g).find((x) => x?.membershipId === membershipId);
  const [label, cls] = STATUS[g.status];
  return (
    <details className="section">
      <summary>
        <span className="meta">
          Game {g.game.number} · {y.stage.get(g.game.stageId) ?? ''}
          <span className={cls}>{label}</span>
          {mine?.delta != null && <strong className="num">{mine.result === null ? 'Bye' : `${mine.result} ${signed(mine.delta)}`}</strong>}
        </span>
      </summary>
      {g.status === 'void' && <p className="muted">This game's tally was deleted, so it doesn't count: no points, and nobody got tired.</p>}
      {g.status === 'pending' && <p className="muted">Scores appear once this game's stats (and every earlier game's) lock.</p>}
      {g.status !== 'void' && g.matchups.map((m) => (
        <div key={m.home.membershipId} className="stack">
          <SideDetail y={y} g={g} side={m.home} />
          {m.away ? <SideDetail y={y} g={g} side={m.away} /> : <p className="muted">Bye</p>}
        </div>
      ))}
    </details>
  );
}

/** A line's points, with the tournament multiplier (×2) that every game score carries alike. */
const raw = (y: LeagueTournament, stats: Record<string, number>) =>
  (y.settings.session_multipliers.tournament ?? 1) * rawScore(stats, y.settings.stat_weights);

function SideDetail({ y, g, side }: { y: LeagueTournament; g: GameOutcome; side: TournamentSide }) {
  const line = side.athleteId === null ? undefined
    : y.input.statLines.find((l) => l.sessionId === g.game.sessionId && l.athleteId === side.athleteId);
  const factors = [
    side.tired !== null && side.tired !== 1 ? ` × ${fmt(side.tired)} tired` : '',
    side.decay !== null && side.decay !== 1 ? ` × ${fmt(side.decay)} earlier seasons` : '',
  ].join('');
  return (
    <div className="stack">
      <p className="head">
        <span><strong>{y.team.get(side.membershipId)}</strong> · {side.athleteId ? y.athlete.get(side.athleteId) : 'forfeit'}</span>
        {side.score !== null && <span className="num">{fmt(side.score)} {side.delta !== null && <>({signed(side.delta)})</>}</span>}
      </p>
      <Notice y={y} side={side} />
      {side.score !== null && side.athleteId !== null && (
        <ul className="list">
          <li>
            <small>{line ? Object.entries(line.stats).filter(([, n]) => n).map(([k, n]) => `${n} ${statLabel(k)}`).join(', ') || 'No stats'
              : `Didn't play: ${fmt(y.settings.absent_score)}`}</small>
            {line && <span className="num">{fmt(raw(y, line.stats))}</span>}
          </li>
          <li>
            <span>Game score{factors}</span>
            <strong className="num">{fmt(side.athleteScore!)}{factors && <>{factors.replace(/ tired| earlier seasons/g, '')} = {fmt(side.score)}</>}</strong>
          </li>
        </ul>
      )}
    </div>
  );
}
```

```diff
diff --git a/src/app/pages/HomePage.tsx b/src/app/pages/HomePage.tsx
index ac7eb47..2638fd9 100644
--- a/src/app/pages/HomePage.tsx
+++ b/src/app/pages/HomePage.tsx
@@ -3,7 +3,7 @@ import { Link } from 'react-router';
 import { useAuth } from '../auth/AuthProvider';
 import { DiscMark } from '../components/Layout';
 import { AuctionCard } from './AuctionCard';
-import { WeeklyCard } from './WeeklyCard';
+import { TournamentCard } from './TournamentCard';
 import { supabase } from '../lib/supabase';
 import { useLoad } from '../lib/useLoad';
 import { balance, entryLabel, LEDGER_COLUMNS, type LedgerEntry } from '../lib/wallet';
@@ -75,7 +75,7 @@ export function HomePage() {
                 joinedAt={m.created_at}
                 teamName={m.team_name} subtitle={subtitle} team={team} wallet={wallet} />
             ) : team}
-            {m.leagues && <WeeklyCard membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id} />}
+            {m.leagues && <TournamentCard membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id} />}
           </Fragment>
         );
       })}
```

```diff
diff --git a/src/app/styles.css b/src/app/styles.css
index c627b7e..b0c0768 100644
--- a/src/app/styles.css
+++ b/src/app/styles.css
@@ -109,7 +109,7 @@ label.check input { width: 22px; height: 22px; min-height: 0; accent-color: var(
 .list .title { font-weight: var(--fw-semi); }
 .list a.title { color: var(--fg); text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; }
 .list a.title:hover { text-decoration: underline; }
-.list li.used .title { color: var(--muted); font-weight: var(--fw-regular); } /* greyed; the "Used" pill says why */
+.list li.used .title { color: var(--muted); font-weight: var(--fw-regular); } /* greyed; its pill says why */
 
 
 /* State in words and shape: pills always carry their own label. */
```

- [ ] **Step 4: Run the tests and checks**

Run: `npx vitest run src && npx tsc -b && npx eslint .`
Expected: all pass (TournamentCard: 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/TournamentCard.tsx src/app/pages/TournamentCard.test.tsx src/app/pages/HomePage.tsx src/app/styles.css
git commit -m "feat(app): League tab Tournament card replaces weekly matchups (tournament mode T3)"
```

---

### Task 3: Tally — Start game, Finish game with the next pairings

**Files:**
- Create: `src/app/pages/GameControls.tsx`, `src/app/pages/GameControls.test.tsx`, `src/app/pages/TallyPage.test.tsx`
- Modify: `src/app/pages/TallyPage.tsx`

**Interfaces:**
- Consumes: `loadCurrentGame`, `seasonPairings`, `describePairings` (Task 1); `api.startGame`, `api.finishGame`
  (Task 1); `CurrentSeason` from `src/app/lib/stats.ts`.
- Produces: `GameControls({ season, sessionId?, unsaved?, onOpen? })`. Without `sessionId` (the session list) it
  renders a card: "Start game N" (confirm: picks lock), or for a live game "Tally game N" + "Finish game N" (or,
  when the game's session was deleted, a void note + "Finish game N"). With `sessionId` (inside `.tally-bar`) it
  renders only "Finish game N", and only on the live game's own board. Finish loads `seasonPairings`, shows them in
  an inline panel (`role="group"`, "Game N+1 pairings…") with Finish / Cancel; disabled while `unsaved > 0`.

The tally's own "New session" stays (amendment 5) with clearer copy, the list labels a game's session
(`pill info` "Game N") and never offers Delete on it (deleting voids the game; admins can still force-delete from
the session page). **Never touch the queue/flush code** in `TallyBoard` (M3 rule).

- [ ] **Step 1: Write the failing tests** (`git checkout t3-verified-draft -- src/app/pages/GameControls.test.tsx src/app/pages/TallyPage.test.tsx`):

`src/app/pages/GameControls.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { api } from '../lib/rpc';
import type { GameRow } from '../lib/tournament';
import { GameControls } from './GameControls';

const state = vi.hoisted(() => ({ game: null as unknown as GameRow }));
const pairings = [{ league_id: 'L', home: 'm1', away: 'm2' }, { league_id: 'L', home: 'm3', away: null }];
const provisional = [{ league_id: 'L', order: ['m1', 'm2', 'm3'], meetings: {} }];
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadCurrentGame: () => Promise.resolve({ stage: { id: 'S1', name: 'Fall beta' }, game: state.game }),
  seasonPairings: () => Promise.resolve({
    pairings, provisional, league: new Map([['L', 'League A']]), team: new Map([['m1', 'Zeal'], ['m2', 'Flow'], ['m3', 'Money']]),
  }),
}));
vi.mock('../lib/rpc', () => ({ api: { startGame: vi.fn(), finishGame: vi.fn() } }));

const season = { id: 'se', name: 'Fall', settings: parseSettings({}) };
const upcoming: GameRow = { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null };
const live: GameRow = { ...upcoming, session_id: 'p2', started_at: '2026-11-07T16:00:00Z' };
const confirm = vi.fn();
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.startGame).mockReset().mockResolvedValue('p2');
  vi.mocked(api.finishGame).mockReset().mockResolvedValue('g3');
  confirm.mockReset().mockReturnValue(true);
  window.confirm = confirm;
});

describe('GameControls', () => {
  it('starts the next game after a confirm and opens its tally', async () => {
    state.game = upcoming;
    const onOpen = vi.fn();
    render(<GameControls season={season} onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start game 2' }));
    expect(confirm.mock.calls[0][0]).toMatch(/pick locks/);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('p2'));
    expect(api.startGame).toHaveBeenCalledWith('g2');
  });

  it('shows the next pairings before finishing, and sends them with their inputs', async () => {
    state.game = live;
    render(<GameControls season={season} sessionId="p2" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finish game 2' }));
    const panel = await screen.findByRole('group', { name: 'Finish game 2' });
    expect(panel.textContent).toContain('Zeal vs Flow · Money has a bye');
    expect(api.finishGame).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finish game 2' }).at(-1)!);
    await waitFor(() => expect(api.finishGame).toHaveBeenCalledWith('g2', pairings, provisional));
    expect(await screen.findByText('Game 2 finished. Game 3 is paired.')).toBeTruthy();
  });

  it("waits for this phone's unsaved taps before finishing", async () => {
    state.game = live;
    render(<GameControls season={season} sessionId="p2" unsaved={3} />);
    expect((await screen.findByRole('button', { name: 'Finish game 2' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("stays off another session's board", async () => {
    state.game = live;
    const { container } = render(<GameControls season={season} sessionId="practice" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });

  it('says so when another keeper started the game first', async () => {
    state.game = upcoming;
    vi.mocked(api.startGame).mockRejectedValue({ message: 'GAME_STARTED' });
    render(<GameControls season={season} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start game 2' }));
    expect(await screen.findByText('Another keeper already started this game.')).toBeTruthy();
  });

  it('can still finish a game whose session was deleted, from the session list', async () => {
    state.game = { ...live, session_id: null };
    render(<GameControls season={season} onOpen={vi.fn()} />);
    expect(await screen.findByText(/tally was deleted/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tally game 2' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Finish game 2' })).toBeTruthy();
  });
});
```

`src/app/pages/TallyPage.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { TallyPage } from './TallyPage';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'k1' } }, isAdmin: false, isKeeper: true, loading: false }),
}));
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve({ id: 'se', name: 'Fall', settings: parseSettings({}) }),
}));
vi.mock('./GameControls', () => ({ GameControls: () => null }));

const session = (id: string, kind: string) => ({
  id, season_id: 'se', kind, held_on: '2026-11-07', counts: true, created_by: 'k1', verified_by: null, verified_at: null,
});
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === 'sessions' ? [session('game', 'tournament'), session('drill', 'practice')]
        : table === 'games' ? [{ session_id: 'game', number: 2 }] : [];
      const builder = {
        select: () => builder, or: () => builder, order: () => builder, in: () => builder, eq: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  },
}));

afterEach(cleanup);

describe('TallyPage session list', () => {
  it("labels a game's session and never offers to delete it (that would void the game)", async () => {
    render(<MemoryRouter><TallyPage /></MemoryRouter>);
    const game = (await screen.findByText('Game 2')).closest('li')!;
    expect(game.textContent).not.toContain('Delete');
    const drill = screen.getByText('Sat, Nov 7 · Practice').closest('li')!;
    expect(drill.textContent).toContain('Delete');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/app/pages/GameControls.test.tsx src/app/pages/TallyPage.test.tsx`
Expected: FAIL — cannot resolve `./GameControls`.

- [ ] **Step 3: Implement** (`git checkout t3-verified-draft -- src/app/pages/GameControls.tsx src/app/pages/TallyPage.tsx`):

`src/app/pages/GameControls.tsx`:

```tsx
import { useState } from 'react';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import type { CurrentSeason } from '../lib/stats';
import { describePairings, loadCurrentGame, seasonPairings } from '../lib/tournament';
import { useLoad } from '../lib/useLoad';

type Preview = Awaited<ReturnType<typeof seasonPairings>>;

/**
 * Tournament controls on the tally screen (spec §2): Start game N on the session list, Finish game N on the live
 * game's board (and on the list, so a game whose session was deleted can still be finished). Finish shows the next
 * game's pairings first: they're frozen once confirmed.
 */
export function GameControls({ season, sessionId, unsaved = 0, onOpen }: {
  season: CurrentSeason;
  /** On a board: show Finish only when this session is the live game's. */
  sessionId?: string;
  /** Taps still on this phone: they'd be missing from the pairing, so Finish waits for them. */
  unsaved?: number;
  /** On the session list: open a session's board. */
  onOpen?: (sessionId: string) => void;
}) {
  const current = useLoad(() => loadCurrentGame(season.id), [season.id]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
      setPreview(null);
    }
    setBusy(false);
    current.reload(); // e.g. GAME_STARTED: another keeper got there first
  }

  const messages = (
    <>
      {status && <p className="success" role="status">{status}</p>}
      {(error || current.error) && <p className="error" role="alert">{error ?? current.error}</p>}
    </>
  );
  const c = current.data;
  if (!c) return messages;
  const { game, stage } = c;
  const n = game.number;
  const live = game.started_at !== null && game.finished_at === null;
  if (sessionId !== undefined && !(live && game.session_id === sessionId)) return messages;

  const start = () => {
    if (!window.confirm(`Start game ${n}? Every team's pick locks now.`)) return;
    void run(async () => {
      const sid = await api.startGame(game.id);
      onOpen?.(sid);
    });
  };
  const finish = () => void run(async () => setPreview(await seasonPairings(season.id)));
  const confirm = (p: Preview) => void run(async () => {
    await api.finishGame(game.id, p.pairings, p.provisional);
    setPreview(null);
    setStatus(`Game ${n} finished. Game ${n + 1} is paired.`);
  });

  return (
    <div className={sessionId === undefined ? 'card' : 'stack'} aria-label="Tournament game">
      {sessionId === undefined && <h2>{stage.name} tournament</h2>}
      {!live && sessionId === undefined && (
        <div className="head">
          <span>Game {n} is next. Starting it locks every team's pick.</span>
          <button disabled={busy} onClick={start}>Start game {n}</button>
        </div>
      )}
      {live && !preview && (
        <div className="head">
          <span>
            {game.session_id ? <>Game {n} is live.</> : <>Game {n}'s tally was deleted, so it won't count. Finish it to pair the next game.</>}
            {unsaved > 0 && <> <small className="muted">Finish waits until your taps are saved.</small></>}
          </span>
          <span className="meta">
            {sessionId === undefined && game.session_id && (
              <button className="secondary" onClick={() => onOpen?.(game.session_id!)}>Tally game {n}</button>
            )}
            <button disabled={busy || unsaved > 0} onClick={finish}>Finish game {n}</button>
          </span>
        </div>
      )}
      {preview && (
        <div className="stack" role="group" aria-label={`Finish game ${n}`}>
          <p><strong>Game {n + 1} pairings</strong>, from the live tally. They can't change once you finish.</p>
          {[...preview.league].map(([leagueId, leagueName]) => (
            <p key={leagueId}>
              {preview.league.size > 1 && <><small className="muted">{leagueName}</small><br /></>}
              {describePairings(preview.pairings.filter((p) => p.league_id === leagueId), preview.team)}
            </p>
          ))}
          <div className="row">
            <button disabled={busy} onClick={() => confirm(preview)}>Finish game {n}</button>
            <button className="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
      {messages}
    </div>
  );
}
```

```diff
diff --git a/src/app/pages/TallyPage.tsx b/src/app/pages/TallyPage.tsx
index 70e9ba7..ddd0732 100644
--- a/src/app/pages/TallyPage.tsx
+++ b/src/app/pages/TallyPage.tsx
@@ -11,6 +11,7 @@ import {
 } from '../lib/stats';
 import { supabase } from '../lib/supabase';
 import { useLoad } from '../lib/useLoad';
+import { GameControls } from './GameControls';
 import {
   BATCH_MAX, canForgetLocally, isRejection, lastUndoable, loadQueue, queuedSessions, queuedToTap, removeSent, rowToTap,
   storeQueue, subtractHint, unsavedTaps,
@@ -50,7 +51,13 @@ function SessionPicker({ season, keeperId, onPick }: {
       .or(unsaved.size ? `${open},id.in.(${[...unsaved.keys()].join(',')})` : open)
       .order('held_on', { ascending: false });
     if (error) throw error;
-    return (data ?? []) as SessionRow[];
+    const rows = (data ?? []) as SessionRow[];
+    const games = rows.length
+      ? await supabase!.from('games').select('session_id, number').in('session_id', rows.map((s) => s.id))
+      : { data: [], error: null };
+    if (games.error) throw games.error;
+    const game = new Map((games.data ?? []).map((g) => [g.session_id as string, g.number as number]));
+    return rows.map((s) => ({ ...s, game: game.get(s.id) ?? null }));
   }, [season.id, unsaved]);
 
   async function remove(s: SessionRow) {
@@ -77,6 +84,7 @@ function SessionPicker({ season, keeperId, onPick }: {
   return (
     <section className="page">
       <h1>Tally</h1>
+      <GameControls season={season} onOpen={onPick} />
       <div className="card">
         <h2>Open sessions</h2>
         {!sessions.data && !sessions.error && <p className="muted" role="status">Loading…</p>}
@@ -86,12 +94,14 @@ function SessionPicker({ season, keeperId, onPick }: {
             <li key={s.id}>
               <span className="meta">
                 <span className="title">{sessionTitle(s)}</span>
+                {s.game !== null && <span className="pill info">Game {s.game}</span>}
                 {!s.counts && <span className="pill">Not counted</span>}
                 {unsaved.has(s.id) && <span className="pill warn">{unsaved.get(s.id)} unsaved</span>}
               </span>
               {/* Never offered while this phone still holds taps for it: they'd have nowhere to go.
-                  Only the creator or an admin may delete (server enforces this too). */}
-              {!s.verified_at && !unsaved.has(s.id) && (s.created_by === keeperId || isAdmin) && (
+                  Only the creator or an admin may delete (server enforces this too). A game's session isn't offered
+                  here: deleting it voids the game (an admin can still force-delete it from the session page). */}
+              {!s.verified_at && !unsaved.has(s.id) && s.game === null && (s.created_by === keeperId || isAdmin) && (
                 <button className="secondary" onClick={() => void remove(s)}>Delete</button>
               )}
               <button className={s.verified_at ? 'secondary' : ''} onClick={() => onPick(s.id)}>{s.verified_at ? 'Open' : 'Tally'}</button>
@@ -111,8 +121,9 @@ function SessionPicker({ season, keeperId, onPick }: {
         </label>
         <label className="check">
           <input type="checkbox" checked={counts} onChange={(e) => setCounts(e.target.checked)} />
-          Counts for fantasy (untick for drills)
+          Counts toward stats (untick for drills)
         </label>
+        <p className="muted"><small>Tournament games are tallied with Start game. A session started here records stats but never scores a matchup.</small></p>
         <button>Start tallying</button>
         {(error || sessions.error) && <p className="error" role="alert">{error ?? sessions.error}</p>}
       </form>
@@ -287,6 +298,7 @@ function TallyBoard({ season, sessionId, keeperId, onBack }: {
             {queue.length > 0 && !online && <span className="pill warn">Offline · {queue.length} unsaved</span>}
           </span>
         </div>
+        <GameControls season={season} sessionId={sessionId} unsaved={queue.length} />
       </div>
       {verified && <p className="notice">This session is verified, so tallying is closed. <Link to={`/stats/${sessionId}`}>View it</Link>.</p>}
       {closed && !verified && <p className="notice">This session is from an earlier season, so tallying is closed here. Taps already saved on this phone still upload.</p>}
```

- [ ] **Step 4: Run the tests and checks**

Run: `npx vitest run src && npx tsc -b && npx eslint .`
Expected: all pass (GameControls: 6 tests, TallyPage: 1).

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/GameControls.tsx src/app/pages/GameControls.test.tsx src/app/pages/TallyPage.tsx src/app/pages/TallyPage.test.tsx
git commit -m "feat(app): tally Start and Finish game with the next Swiss pairings (tournament mode T3)"
```

---

### Task 4: Admin — Open tournament, Check pairings; retire the weekly screens

**Files:**
- Modify: `src/app/pages/admin/StagesPanel.tsx` (weeks controls → `TournamentControls`; allowance ranks from
  tournament standings), `src/app/pages/admin/BackupPanel.tsx`, `src/app/lib/backup.ts`, `src/app/lib/backup.test.ts`
  (standings CSV from the tournament), `src/app/lib/rpc.ts` (whole draft file: drops `setPick`, `createStageWeeks`,
  `setWeekLock`)
- Delete: `src/app/pages/WeeklyCard.tsx`, `src/app/lib/weekly.ts`, `src/app/lib/weekly.test.ts`
- Modify: `tests/db/dry-run.test.ts` (it imported `weekly.ts`: now plays a whole tournament)

**Interfaces:**
- Consumes: `seasonPairings`, `seasonRanks(seasonId, stageId)`, `checkPairing`, `describePairings`, `GAME_COLUMNS`,
  `GameRow`, `GamePairing`, `LeaguePairingInput`, `loadLeagueTournament`, `fetchAll`, `toTournamentInput`,
  `toPairings` (Task 1); core `pairingInputs`, `lineup`, `scoreTournaments`.
- Produces: nothing new for later tasks. After this task nothing imports `weekly.ts` or `year.ts`'s `scoreYear` from
  the app (T4 retires `year.ts`).

`TournamentControls` (per stage, after its auction has run): no games → **Open tournament** (computes
`seasonPairings`, confirms with `describePairings`, calls `api.openTournament`). Games → a `<details>` "Tournament ·
game N live|next" with **Check pairings**: reads `audit_log` rows `action = 'finish_game'` for the stage's games
(admins only can read them, and this panel is admin-only) and prints one line per finished game, "Game N+1: matches
a Swiss re-run…" or "doesn't match a Swiss re-run. Look at this finish_game row in the audit log."

The dry run plays one tournament through the app's own path: six managers, auction as before, then
`open_tournament` with `pairingInputs(toTournamentInput(rows))` pairings, three games (Ben's game-2 pick hurt at the
start, Dee repeats a player in game 2, Cal forgets game 3), keeper taps, `finish_game` with provisional pairings,
another keeper verifies. It asserts three final games + an upcoming fourth, no rematch, every finish passes
`checkPairing`, the notices and the ×0.5 tiredness, determinism, and the next stage's allowance.

- [ ] **Step 1: Write the failing tests** (`git checkout t3-verified-draft -- src/app/lib/backup.test.ts tests/db/dry-run.test.ts`):

```diff
diff --git a/src/app/lib/backup.test.ts b/src/app/lib/backup.test.ts
index 2dbc6f4..1b95cc1 100644
--- a/src/app/lib/backup.test.ts
+++ b/src/app/lib/backup.test.ts
@@ -1,6 +1,6 @@
 import { describe, expect, it } from 'vitest';
 import { BACKUP_TABLES, ledgerRows, standingsRows } from './backup';
-import type { LeagueYear } from './weekly';
+import type { LeagueTournament } from './tournament';
 
 describe('backup', () => {
   it('lists every table the migrations create', async () => {
@@ -27,9 +27,9 @@ describe('backup', () => {
     const row = (membershipId: string, place: number, tied: boolean, points: number) =>
       ({ membershipId, place, tied, points, rank: place, wins: 1, losses: 0, ties: 0, totalScore: 3.456 });
     const year = {
-      result: { weeks: [], standings: [row('b', 2, true, 1), row('a', 1, false, 2.256), row('c', 2, true, 1)] },
+      result: { games: [], standings: [row('b', 2, true, 1), row('a', 1, false, 2.256), row('c', 2, true, 1)] },
       team: new Map([['a', 'Zeal'], ['b', 'Money'], ['c', 'Gimp']]),
-    } as unknown as LeagueYear;
+    } as unknown as LeagueTournament;
     expect(standingsRows([{ name: 'A', year }]).map((r) => r.slice(0, 4))).toEqual([
       ['league', 'place', 'team', 'points'], ['A', '1', 'Zeal', 2.26], ['A', 'T2', 'Money', 1], ['A', 'T2', 'Gimp', 1],
     ]);
```

`tests/db/dry-run.test.ts`:

```ts
// Full dry run (M8 board t36, tournament mode since T3): six fake managers play one stage's tournament end to end on
// the real migrations. Pairings come from the app's own path (rows as loadLeagueRows reads them → toTournamentInput →
// pairingInputs), and scoreTournaments scores the result. Prints the standings for a hand check.
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, bid, closeBids, grant, injure, member, openAuction, runAuction, type AuctionFixture } from './auction-fixture';
import { makeKeeper, tap } from './stats-fixture';
import { stageAllowance } from '../../src/core/points';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { lineup, pairingInputs, scoreTournaments, type TournamentResult } from '../../src/core/tournament';
import { checkPairing, toPairings, toTournamentInput, type TournamentRows } from '../../src/app/lib/tournament';

let f: AuctionFixture;
let teams: { uid: string; mid: string; name: string }[];
let keeper: string, verifier: string;
let result: TournamentResult;
let rows: TournamentRows;
const NOW = Date.parse('2027-01-01T00:00:00Z'); // long after the stage: everything final
const START = 115; // everyone ties before the first game: (100 + 130) / 2

const q = async <T,>(sql: string, params: unknown[] = []) => (await f.db.query<T>(sql, params)).rows;
const iso = (col: string) => `to_json(${col}) #>> '{}' as ${col.split('.').pop()}`;

/** Every row the way loadLeagueRows reads them for staff (with live taps). */
const readRows = async (): Promise<TournamentRows> => ({
  settings: (await q<{ settings: unknown }>('select settings from public.seasons where id = $1', [f.season]))[0].settings,
  stages: await q(`select id, name, starts_on::text, ${iso('bid_close_at')}, auction_seed, ${iso('auction_run_at')}
    from public.stages where season_id = $1`, [f.season]),
  games: await q(`select id, stage_id, number, session_id, ${iso('started_at')}, ${iso('finished_at')} from public.games`),
  pairings: await q('select game_id, home, away from public.game_pairings where league_id = $1', [f.league]),
  members: await q(`select id, team_name, ${iso('created_at')} from public.memberships where league_id = $1`, [f.league]),
  slots: await q('select stage_id, membership_id, athlete_id, price, bench from public.roster_slots'),
  picks: await q('select stage_id, game_number, membership_id, athlete_id from public.game_picks'),
  swaps: await q('select stage_id, membership_id, out_athlete, in_athlete, from_game from public.bench_swaps'),
  sessions: await q(`select id, ${iso('verified_at')} from public.sessions where id in (select session_id from public.games)`),
  lines: await q('select session_id, athlete_id, stats, points_played from public.stat_lines'),
  taps: await q(`select id, session_id, athlete_id, stat, keeper_id, ${iso('tapped_at')}, undoes from public.stat_taps`),
  injuries: await q(`select athlete_id, ${iso('confirmed_at')}, ${iso('cleared_at')} from public.injuries`),
  athletes: await q('select id, name from public.athletes where season_id = $1', [f.season]),
});

/** The next game's pairings and their inputs, as the finishing keeper's phone computes them. */
const pairNext = async () => {
  const provisional = [{ league_id: f.league, ...pairingInputs(toTournamentInput(await readRows(), Date.now())) }];
  return { pairings: provisional.flatMap(toPairings), provisional };
};

beforeAll(async () => {
  f = await auctionFixture(25); // 24 healthy for 24 slots, so the fill deals every one of them
  teams = [];
  for (const name of ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay']) {
    const [uid, mid] = await member(f.db, name);
    teams.push({ uid, mid, name });
  }
  keeper = await createUser(f.db, 'keeper@x.test');
  verifier = await createUser(f.db, 'verifier@x.test');
  await makeKeeper(f.db, keeper);
  await makeKeeper(f.db, verifier);
  await injure(f, f.athletes[24]); // the fill must never deal A24

  // Credits and a sealed auction: a tie on A0 (Ava bids first), Ben overspends, the rest bid a little.
  await grant(f);
  await openAuction(f);
  await bid(f, teams[0].uid, teams[0].mid, f.athletes[0], 50);
  await bid(f, teams[1].uid, teams[1].mid, f.athletes[0], 50);
  // Same-millisecond placed_at would leave the tie to a random id: make Ava's bid clearly first.
  await f.db.query(`update public.bids set placed_at = placed_at - interval '1 second' where membership_id = $1 and athlete_id = $2`,
    [teams[0].mid, f.athletes[0]]);
  for (const [i, t] of teams.entries()) await bid(f, t.uid, t.mid, f.athletes[3 + i], 10 + i);
  // Ben overspends. place_bid refuses a total over the balance since M8.5, so these are direct writes: they exercise
  // run_auction's affordability skip, the safety net for a balance lowered mid-auction.
  for (const [athlete, amount] of [[f.athletes[1], 100], [f.athletes[2], 100]] as const) {
    await f.db.query(`insert into public.bids (stage_id, membership_id, league_id, athlete_id, amount) values ($1, $2, $3, $4, $5)`,
      [f.stage, teams[1].mid, f.league, athlete, amount]); // A2 is unaffordable after A1
  }
  await closeBids(f);
  expect(await runAuction(f)).toEqual({ by_bid: 8, by_fill: 16, empty: 0 });

  // The tournament: game 1 paired by the (all tied) standings, then three games. Ben's game 2 pick is hurt at its
  // start, Dee starts the same player in games 1 and 2 (tired), Cal forgets game 3.
  const first = await pairNext();
  await as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: first.pairings }));
  const sessionLines = new Map<string, { athlete_id: string; stats: Record<string, number> }[]>();
  for (const n of [1, 2, 3]) {
    const input = toTournamentInput(await readRows(), Date.now());
    for (const [i, t] of teams.entries()) {
      if (n === 3 && i === 2) continue;
      const { active } = lineup(input, t.mid, f.stage, n);
      const athlete = i === 3 && n === 2 ? active[0] : active[(n - 1) % active.length];
      await as(f.db, t.uid, (tx) => rpc(tx, 'set_game_pick', { p_membership: t.mid, p_stage: f.stage, p_number: n, p_athlete: athlete }));
    }
    if (n === 2) {
      const [{ athlete_id: hurt }] = await q<{ athlete_id: string }>(
        'select athlete_id from public.game_picks where membership_id = $1 and game_number = 2', [teams[1].mid]);
      await f.db.query(`insert into public.injuries (athlete_id, confirmed_at) values ($1, now() - interval '1 minute')`, [hurt]);
    }
    const [{ id: game }] = await q<{ id: string }>('select id from public.games where stage_id = $1 and number = $2', [f.stage, n]);
    const session = (await as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game }))) as string;
    // Ben's player recovers after the start (A24 stays out: it was never dealt).
    await f.db.query('update public.injuries set cleared_at = now() where cleared_at is null and athlete_id <> $1', [f.athletes[24]]);

    // Stats for every rostered player, tallied by one keeper.
    const taps: ReturnType<typeof tap>[] = [];
    const lines: { athlete_id: string; stats: Record<string, number> }[] = [];
    for (const [i, a] of f.athletes.slice(0, 24).entries()) {
      const stats = { goal: (i + n) % 3, assist: (i * 7 + n) % 2, turnover: (i + n) % 2 };
      if (!Object.values(stats).some(Boolean)) continue;
      lines.push({ athlete_id: a, stats });
      const at = new Date().toISOString();
      for (const [stat, k] of Object.entries(stats)) for (let j = 0; j < k; j++) taps.push(tap(a, stat, at));
    }
    await as(f.db, keeper, (tx) => rpc(tx, 'save_taps', { p_session: session, p_client_now: new Date().toISOString(), p_taps: taps }));
    const next = await pairNext(); // provisional: this game's live taps count
    await as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: next.pairings, p_provisional: next.provisional }));
    sessionLines.set(session, lines);
  }

  // After the tournament: another keeper verifies every game, and the stats lock.
  for (const [session, lines] of sessionLines) {
    await as(f.db, verifier, (tx) => rpc(tx, 'verify_session', { p_session: session, p_lines: lines }));
  }
  await f.db.query(`update public.sessions set verified_at = '2026-11-08T00:00:00Z' where id in (select session_id from public.games)`);
  rows = await readRows();
  result = scoreTournaments(toTournamentInput(rows, NOW));
}, 120_000);

const team = (mid: string) => teams.find((t) => t.mid === mid)!.name;
const sideOf = (n: number, mid: string) =>
  result.games.find((g) => g.game.number === n)!.matchups.flatMap((m) => [m.home, m.away]).find((x) => x?.membershipId === mid)!;

describe('dry run: one tournament, six managers', () => {
  it('ran the auction: full exclusive rosters, the tie to the first bid, no injured fill, no overspend', async () => {
    const slots = await q<{ membership_id: string; athlete_id: string; price: number }>(
      'select membership_id, athlete_id, price from public.roster_slots');
    expect(slots).toHaveLength(24);
    expect(new Set(slots.map((x) => x.athlete_id)).size).toBe(24);
    expect(slots.some((x) => x.athlete_id === f.athletes[24])).toBe(false);
    expect(slots.find((x) => x.athlete_id === f.athletes[0])?.membership_id).toBe(teams[0].mid);
    expect(slots.some((x) => x.athlete_id === f.athletes[2])).toBe(true); // dealt by the fill instead
    for (const t of teams) expect(slots.filter((x) => x.membership_id === t.mid)).toHaveLength(4);
    const balances = await q<{ membership_id: string; b: number }>(
      'select membership_id, sum(amount)::int as b from public.credit_ledger group by 1');
    for (const r of balances) {
      const spent = slots.filter((x) => x.membership_id === r.membership_id).reduce((s, x) => s + x.price, 0);
      expect(r.b).toBe(START - spent);
      expect(r.b).toBeGreaterThanOrEqual(0);
    }
  });

  it('scored three final games where every team played every game, and paired a fourth', () => {
    expect(result.games.map((g) => g.status)).toEqual(['final', 'final', 'final', 'upcoming']);
    for (const s of result.standings) {
      expect(Number.isFinite(s.points)).toBe(true);
      expect(s.wins + s.losses + s.ties).toBe(3);
    }
  });

  it('paired Swiss without a rematch, and every pairing passes Check pairing', async () => {
    const pairs = await q<{ home: string; away: string }>(`select home, away from public.game_pairings p
      join public.games g on g.id = p.game_id where g.number <= 3`);
    expect(new Set(pairs.map((p) => [p.home, p.away].sort().join())).size).toBe(9);
    const finishes = await q<{ details: Parameters<typeof checkPairing>[0] }>(
      `select details from public.audit_log where action = 'finish_game'`);
    expect(finishes).toHaveLength(3);
    for (const r of finishes) expect(checkPairing(r.details)).toBe(true);
  });

  it('swapped the injured pick, filled the missed one, and tired the repeat', () => {
    const ben = sideOf(2, teams[1].mid);
    expect(ben.notice).toBe('injured');
    expect(ben.athleteId).not.toBe(ben.picked);
    const cal = sideOf(3, teams[2].mid);
    expect(cal.notice).toBe('missed');
    expect(cal.athleteId).not.toBeNull();
    expect(sideOf(2, teams[3].mid)).toMatchObject({ notice: null, tired: 0.5 });
    expect(sideOf(3, teams[0].mid).tired).toBe(1); // Ava cycled through her three actives
  });

  it('is deterministic', () => {
    expect(scoreTournaments(toTournamentInput(rows, NOW))).toEqual(result);
  });

  it('grants the next stage allowance from these standings, matching the TypeScript formula', async () => {
    const next = (await as(f.db, f.admin, (tx) => rpc(tx, 'create_stage', {
      p_season: f.season, p_name: 'Winter', p_starts_on: '2026-11-09', p_ends_on: '2026-11-29', p_tournament: null }))) as string;
    const ranks = Object.fromEntries(result.standings.map((s) => [s.membershipId, s.rank]));
    expect(await as(f.db, f.admin, (tx) => rpc(tx, 'grant_stage_allowance', { p_stage: next, p_ranks: ranks }))).toBe(6);
    const got = await q<{ membership_id: string; amount: number }>(
      `select membership_id, amount from public.credit_ledger where stage_id = $1 and kind = 'allowance'`, [next]);
    for (const g of got) expect(g.amount).toBe(stageAllowance(ranks[g.membership_id], 6, DEFAULT_SETTINGS));

    console.table(result.standings.map((s) => ({
      place: `${s.tied ? 'T' : ''}${s.place}`, team: team(s.membershipId), points: +s.points.toFixed(2),
      'W-L-T': `${s.wins}-${s.losses}-${s.ties}`, score: +s.totalScore.toFixed(2),
      'next allowance': got.find((g) => g.membership_id === s.membershipId)?.amount,
    })));
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx tsc -b`
Expected: FAIL — `backup.test.ts` types its fixture as `LeagueTournament` but `standingsRows` still takes
`LeagueYear`. (The dry run passes as soon as Task 1 is in: it pins the database + data-layer path end to end.)

- [ ] **Step 3: Implement**

```bash
git checkout t3-verified-draft -- src/app/pages/admin/StagesPanel.tsx src/app/pages/admin/BackupPanel.tsx src/app/lib/backup.ts src/app/lib/rpc.ts
git rm src/app/pages/WeeklyCard.tsx src/app/lib/weekly.ts src/app/lib/weekly.test.ts
```

```diff
diff --git a/src/app/pages/admin/StagesPanel.tsx b/src/app/pages/admin/StagesPanel.tsx
index 63b6659..e0a81f5 100644
--- a/src/app/pages/admin/StagesPanel.tsx
+++ b/src/app/pages/admin/StagesPanel.tsx
@@ -5,7 +5,9 @@ import { api } from '../../lib/rpc';
 import { supabase } from '../../lib/supabase';
 import { formatDay } from '../../lib/stats';
 import { useLoad } from '../../lib/useLoad';
-import { seasonRanks, WEEK_COLUMNS, type WeekRow } from '../../lib/weekly';
+import {
+  checkPairing, describePairings, GAME_COLUMNS, seasonPairings, seasonRanks, type GameRow, type GamePairing, type LeaguePairingInput,
+} from '../../lib/tournament';
 
 interface StageRow {
   id: string; name: string; starts_on: string; ends_on: string; tournament: string | null;
@@ -53,10 +55,10 @@ export function StagesPanel({ seasonId }: { seasonId: string }) {
       <h2>Stages</h2>
       {!stages.data && !stages.error && <p className="muted" role="status">Loading…</p>}
       <p className="muted">
-        Players see stages as "seasons". Grant a stage's allowance before its auction: it pays by the current
-        standings, and running it again only credits teams that joined since. Then open the auction with a closing
-        time, run it once bids close, and create the stage's weeks. Weeks run Monday to Sunday; picks lock at the
-        season's pick_lock_day and pick_lock_time (Eastern). After changing a stage's dates, rebuild its weeks.
+        Players see stages as "seasons". Each stage is one tournament. Grant a stage's allowance before its auction:
+        it pays by the current standings, and running it again only credits teams that joined since. Then open the
+        auction with a closing time, run it once bids close, and open the tournament: game 1 is paired by the
+        standings. Keepers start and finish each game on the Tally tab.
       </p>
       <ul className="list">
         {stages.data?.map((s) => (
@@ -71,9 +73,9 @@ export function StagesPanel({ seasonId }: { seasonId: string }) {
                 id: s.id, name: s.name, starts_on: s.starts_on, ends_on: s.ends_on, tournament: s.tournament ?? '',
               })}>Edit</button>
               <button onClick={() => void run(async () => {
-                const { ranks, unsettled } = await seasonRanks(seasonId, s.starts_on);
+                const { ranks, unsettled } = await seasonRanks(seasonId, s.id);
                 if (unsettled > 0 && !window.confirm(
-                  `${unsettled} earlier ${unsettled === 1 ? 'week is' : 'weeks are'} not final yet, so the standings may still change. Grant anyway?`)) return;
+                  `${unsettled} earlier ${unsettled === 1 ? 'game is' : 'games are'} not final yet, so the standings may still change. Grant anyway?`)) return;
                 const n = await api.grantStageAllowance(s.id, ranks);
                 return `${s.name}: credited ${n} ${n === 1 ? 'team' : 'teams'}.`;
               })}>
@@ -81,7 +83,7 @@ export function StagesPanel({ seasonId }: { seasonId: string }) {
               </button>
             </span>
             <AuctionControls stage={s} run={run} />
-            <WeeksControls stage={s} run={run} />
+            <TournamentControls stage={s} seasonId={seasonId} run={run} />
           </li>
         ))}
       </ul>
@@ -146,61 +148,63 @@ function AuctionControls({ stage, run }: { stage: StageRow; run: (action: () =>
   );
 }
 
-function WeeksControls({ stage, run }: { stage: StageRow; run: (action: () => Promise<string | void>) => Promise<void> }) {
-  const weeks = useLoad(async () => {
-    const { data, error } = await supabase!.from('weeks').select(WEEK_COLUMNS).eq('stage_id', stage.id).order('starts_on');
+interface FinishAudit { entity_id: string; details: { pairings: GamePairing[]; provisional: LeaguePairingInput[] } }
+
+/** Open the stage's tournament once its auction has run; then staff can re-check every Swiss pairing a keeper made. */
+function TournamentControls({ stage, seasonId, run }: {
+  stage: StageRow; seasonId: string; run: (action: () => Promise<string | void>) => Promise<void>;
+}) {
+  const [checks, setChecks] = useState<string[] | null>(null);
+  const games = useLoad(async () => {
+    const { data, error } = await supabase!.from('games').select(GAME_COLUMNS).eq('stage_id', stage.id).order('number');
     if (error) throw error;
-    return (data ?? []) as WeekRow[];
+    return (data ?? []) as GameRow[];
   }, [stage.id]);
-  const act = (action: () => Promise<string | void>) => run(async () => {
-    const done = await action();
-    weeks.reload();
-    return done;
+  if (!stage.auction_run_at) return null;
+  if (games.error) return <p className="error" role="alert">{games.error}</p>;
+  if (!games.data) return null;
+
+  if (games.data.length === 0) {
+    return (
+      <div className="row">
+        <button onClick={() => void run(async () => {
+          const p = await seasonPairings(seasonId);
+          if (!window.confirm(`Open the ${stage.name} tournament? Game 1: ${describePairings(p.pairings, p.team)}.`)) return;
+          await api.openTournament(stage.id, p.pairings);
+          games.reload();
+          return `${stage.name}: game 1 is paired. Keepers start it on the Tally tab.`;
+        })}>Open tournament</button>
+      </div>
+    );
+  }
+
+  const last = games.data[games.data.length - 1];
+  const number = new Map(games.data.map((g) => [g.id, g.number]));
+  const check = () => void run(async () => {
+    const { data, error } = await supabase!.from('audit_log').select('entity_id, details')
+      .eq('action', 'finish_game').in('entity_id', games.data!.map((g) => g.id));
+    if (error) throw error;
+    const rows = ((data ?? []) as FinishAudit[]).sort((a, b) => number.get(a.entity_id)! - number.get(b.entity_id)!);
+    setChecks(rows.map((r) => `Game ${number.get(r.entity_id)! + 1}: ${checkPairing(r.details)
+      ? 'matches a Swiss re-run of the standings it was made from.'
+      : "doesn't match a Swiss re-run. Look at this finish_game row in the audit log."}`));
   });
-  const n = weeks.data?.length ?? 0;
   return (
     <details className="section">
-      <summary>Weeks {weeks.data && <span className="muted">· {n === 0 ? 'none yet' : n}</span>}</summary>
+      <summary>Tournament <span className="muted">· game {last.number} {last.started_at ? 'live' : 'next'}</span></summary>
       <div className="stack">
-        <button className={n === 0 ? '' : 'secondary'} onClick={() => {
-          if (n > 0 && !window.confirm(`Rebuild the ${stage.name} weeks from its dates? Custom lock times are lost.`)) return;
-          void act(async () => `${stage.name}: ${await api.createStageWeeks(stage.id)} weeks.`);
-        }}>{n === 0 ? 'Create weeks' : 'Rebuild weeks'}</button>
-        <ul className="list">
-          {weeks.data?.map((w) => <WeekLock key={`${w.id}:${w.pick_lock_at}`} week={w} act={act} />)}
-        </ul>
-        {weeks.error && <p className="error" role="alert">{weeks.error}</p>}
+        <p className="muted">
+          Game 1 was paired when the tournament opened. Each later pairing came from the phone that finished the game
+          before it. Check re-runs the Swiss step on the standings that phone sent; the audit log has those standings.
+        </p>
+        <button className="secondary" onClick={check}>Check pairings</button>
+        {checks && (
+          <ul className="list">
+            {checks.length === 0 && <li className="muted">No game has finished yet.</li>}
+            {checks.map((c) => <li key={c}>{c}</li>)}
+          </ul>
+        )}
       </div>
     </details>
   );
 }
-
-/** datetime-local works in the admin's own time zone. */
-const toLocalInput = (iso: string) => {
-  const d = new Date(iso);
-  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
-};
-
-function WeekLock({ week, act }: { week: WeekRow; act: (action: () => Promise<string | void>) => Promise<void> }) {
-  const [value, setValue] = useState(toLocalInput(week.pick_lock_at));
-  return (
-    <li>
-      <span>
-        <span className="title">{formatDay(week.starts_on)} – {formatDay(week.ends_on)}</span><br />
-        <small>Picks lock {formatWhen(week.pick_lock_at)}</small>
-      </span>
-      <form className="row" onSubmit={(e) => {
-        e.preventDefault();
-        const at = new Date(value).toISOString();
-        if (new Date(at) <= new Date() && !window.confirm("This locks this week's picks now, and a passed lock can't be moved back. Lock now?")) return;
-        void act(async () => {
-          await api.setWeekLock(week.id, at);
-          return `Week of ${formatDay(week.starts_on)}: picks lock ${formatWhen(at)}.`;
-        });
-      }}>
-        <label>Lock (your time)<input type="datetime-local" required value={value} onChange={(e) => setValue(e.target.value)} /></label>
-        <button className="secondary" disabled={value === toLocalInput(week.pick_lock_at)}>Save lock</button>
-      </form>
-    </li>
-  );
-}
```

```diff
diff --git a/src/app/pages/admin/BackupPanel.tsx b/src/app/pages/admin/BackupPanel.tsx
index ade0117..19f6fbf 100644
--- a/src/app/pages/admin/BackupPanel.tsx
+++ b/src/app/pages/admin/BackupPanel.tsx
@@ -3,7 +3,7 @@ import { ledgerRows, loadBackup, standingsRows, type LedgerLeague } from '../../
 import { errorMessage } from '../../lib/errors';
 import { downloadText, todayLocal, toCsv } from '../../lib/stats';
 import { supabase } from '../../lib/supabase';
-import { loadLeagueYear } from '../../lib/weekly';
+import { loadLeagueTournament } from '../../lib/tournament';
 
 /** Manual backups: the free Supabase plan keeps none we can download. Run it weekly (ops checklist). */
 export function BackupPanel({ seasonId }: { seasonId: string }) {
@@ -47,7 +47,7 @@ export function BackupPanel({ seasonId }: { seasonId: string }) {
 
   const standings = () => run('standings', async () => {
     const ls = await leagues();
-    const years = await Promise.all(ls.map(async (l) => ({ name: l.name, year: await loadLeagueYear(seasonId, l.id) })));
+    const years = await Promise.all(ls.map(async (l) => ({ name: l.name, year: await loadLeagueTournament(seasonId, l.id) })));
     downloadText(`tribe-standings-${todayLocal()}.csv`, toCsv(standingsRows(years)));
     return `Saved standings for ${ls.length} ${ls.length === 1 ? 'league' : 'leagues'}.`;
   });
```

```diff
diff --git a/src/app/lib/backup.ts b/src/app/lib/backup.ts
index 72183fd..38044d0 100644
--- a/src/app/lib/backup.ts
+++ b/src/app/lib/backup.ts
@@ -1,5 +1,5 @@
-import type { LeagueYear } from './weekly';
-import { fetchAll } from './weekly';
+import type { YearStanding } from '../../core/year';
+import { fetchAll } from './tournament';
 import { supabase } from './supabase';
 
 /** Every public table and a unique order, so paged reads never skip or repeat a row. */
@@ -48,7 +48,7 @@ export function ledgerRows(leagues: LedgerLeague[]): (string | number)[][] {
 }
 
 /** The League tab's standings, one row per team, best first. */
-export function standingsRows(leagues: { name: string; year: LeagueYear }[]): (string | number)[][] {
+export function standingsRows(leagues: { name: string; year: { result: { standings: YearStanding[] }; team: Map<string, string> } }[]): (string | number)[][] {
   const rows = leagues.flatMap(({ name, year }) => [...year.result.standings]
     .sort((a, b) => a.place - b.place)
     .map((s) => [name, `${s.tied ? 'T' : ''}${s.place}`, year.team.get(s.membershipId) ?? s.membershipId,
```

```diff
diff --git a/src/app/lib/rpc.ts b/src/app/lib/rpc.ts
index 543700e..c5c533c 100644
--- a/src/app/lib/rpc.ts
+++ b/src/app/lib/rpc.ts
@@ -1,5 +1,6 @@
 import type { QueuedTap } from '../tally/queue';
 import { supabase } from './supabase';
+import type { GamePairing, LeaguePairingInput } from './tournament';
 
 async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
   if (!supabase) throw new Error('NOT_CONFIGURED');
@@ -51,10 +52,6 @@ export const api = {
     }),
   grantStageAllowance: (stageId: string, ranks: Record<string, number>) =>
     call<number>('grant_stage_allowance', { p_stage: stageId, p_ranks: ranks }),
-  createStageWeeks: (stageId: string) => call<number>('create_stage_weeks', { p_stage: stageId }),
-  setWeekLock: (weekId: string, at: string) => call<void>('set_week_lock', { p_week: weekId, p_at: at }),
-  setPick: (membershipId: string, weekId: string, athleteId: string | null) =>
-    call<void>('set_pick', { p_membership: membershipId, p_week: weekId, p_athlete: athleteId }),
   recordDonation: (membershipId: string, dollars: number, note: string) =>
     call<number>('record_donation', { p_membership: membershipId, p_dollars: dollars, p_note: note }),
   adjustCredits: (membershipId: string, amount: number, note: string) =>
@@ -66,4 +63,15 @@ export const api = {
     call<void>('delete_bid', { p_stage: stageId, p_membership: membershipId, p_athlete: athleteId }),
   runAuction: (stageId: string) =>
     call<{ by_bid: number; by_fill: number; empty: number }>('run_auction', { p_stage: stageId }),
+  openTournament: (stageId: string, pairings: GamePairing[]) =>
+    call<string>('open_tournament', { p_stage: stageId, p_pairings: pairings }),
+  startGame: (gameId: string) => call<string>('start_game', { p_game: gameId }),
+  finishGame: (gameId: string, pairings: GamePairing[], provisional: LeaguePairingInput[]) =>
+    call<string>('finish_game', { p_game: gameId, p_pairings: pairings, p_provisional: provisional }),
+  setGamePick: (membershipId: string, stageId: string, number: number, athleteId: string | null) =>
+    call<void>('set_game_pick', { p_membership: membershipId, p_stage: stageId, p_number: number, p_athlete: athleteId }),
+  setBench: (membershipId: string, stageId: string, athleteIds: string[]) =>
+    call<void>('set_bench', { p_membership: membershipId, p_stage: stageId, p_athletes: athleteIds }),
+  swapBench: (membershipId: string, stageId: string, outAthlete: string, inAthlete: string) =>
+    call<void>('swap_bench', { p_membership: membershipId, p_stage: stageId, p_out: outAthlete, p_in: inAthlete }),
 };
```

- [ ] **Step 4: Run the tests and checks**

Run: `npx tsc -b && npx eslint . && npx vitest run src && npm run build`, then on its own `npx vitest run tests/db`
Expected: all pass; `grep -rn "weekly" src` finds only the ops comment "Run it weekly" in `BackupPanel.tsx`.

- [ ] **Step 5: Commit**

```bash
git add -A src tests
git commit -m "feat(app): Open tournament and Check pairings; weekly screens retired (tournament mode T3)"
```

---

### Task 5: Rules page for tournament play

**Files:**
- Modify: `src/app/pages/RulesPage.tsx`, `src/app/pages/RulesPage.test.tsx`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS` (`roster_size` 4, `bench_size` 1, `tiredness_multipliers` [0.5, 0.75],
  `session_multipliers.tournament` 2). Every number on the page comes from the settings, never typed in.
- Produces: nothing.

Changes: "The year" (each season is one tournament; one matchup per game; 3 active + 1 bench), "Your game picks"
replaces "Your weekly pick" (Swiss, pick any time before the start, sealed, rested-first auto-pick, bench choice
and the one injury swap) with a "Tired players" table, "Scoring" is one game (practices aren't scored) with a
tired example, and "Who can see what" says picks stay hidden until the game starts.

- [ ] **Step 1: Write the failing test** (`git checkout t3-verified-draft -- src/app/pages/RulesPage.test.tsx`):

```diff
diff --git a/src/app/pages/RulesPage.test.tsx b/src/app/pages/RulesPage.test.tsx
index 6b12fb0..c0fd2c8 100644
--- a/src/app/pages/RulesPage.test.tsx
+++ b/src/app/pages/RulesPage.test.tsx
@@ -9,10 +9,12 @@ describe('RulesPage', () => {
   it('computes its numbers from the default settings', () => {
     render(<RulesPage />);
     const text = document.body.textContent ?? '';
-    // Allowance: 100 for first, 130 for last. Example week: practice 3+6−2 = 7, tournament (6+3−4)×2 = 10 → 17.
+    // Allowance: 100 for first, 130 for last. Example game: (6+3−4)×2 = 10, ×0.5 tired = 5.
     expect(text).toContain('100 for the team in first, up to 130 for the team in last');
-    expect(text).toMatch(/Week score: 17\./);
-    expect(text).toContain('Picks lock Monday at 9:00 PM');
+    expect(text).toMatch(/Game score: 10\. If you also started them the game before, it's 10 × 0\.5 = 5\./);
+    expect(text).toContain('Picks lock when a stat keeper starts the game');
+    expect(text).toContain('4 players: 3 active and 1 on the bench');
+    expect(screen.getByText('2 games before').parentElement?.textContent).toBe('2 games before×0.75');
     // Last beats 1st with upset_k 0.5: 3 × (1 + 0.5) = +4.5 for the winner, −1 × 1.5 = −1.5 for the loser.
     expect(screen.getByText('Last beats 1st').parentElement?.textContent).toBe('Last beats 1st+4.5-1.5');
   });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/pages/RulesPage.test.tsx`
Expected: FAIL — the page still says "Week score: 17." and "Picks lock Monday at 9:00 PM".

- [ ] **Step 3: Implement** (`git checkout t3-verified-draft -- src/app/pages/RulesPage.tsx`):

```diff
diff --git a/src/app/pages/RulesPage.tsx b/src/app/pages/RulesPage.tsx
index 118b4e3..b7e1086 100644
--- a/src/app/pages/RulesPage.tsx
+++ b/src/app/pages/RulesPage.tsx
@@ -4,23 +4,15 @@ import { DEFAULT_SETTINGS as S } from '../../core/settings';
 import { stageMultiplier } from '../../core/decay';
 import { statLabel } from '../lib/stats';
 
-const LOCK_DAY: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
 const n = (x: number) => +x.toFixed(2);
 const signed = (x: number) => (x > 0 ? `+${n(x)}` : `${n(x)}`);
 
-/** 9:00 PM from '21:00'. */
-function clock(hhmm: string) {
-  const [h, m] = hhmm.split(':').map(Number);
-  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
-}
-
-// The worked example: one practice and one tournament for the same player in one week.
-const practice = { goal: 1, assist: 2, turnover: 1 };
-const tournament = { goal: 2, block: 1, turnover: 2 };
-const weekScore = athleteWeekScore([
-  { athleteId: 'x', sessionType: 'practice', pointsPlayed: 0, stats: practice },
-  { athleteId: 'x', sessionType: 'tournament', pointsPlayed: 0, stats: tournament },
-], S);
+// The worked example: one player's stats in one game.
+const game = { goal: 2, block: 1, turnover: 2 };
+const gameScore = athleteWeekScore([{ athleteId: 'x', sessionType: 'tournament', pointsPlayed: 0, stats: game }], S);
+const tired = S.tiredness_multipliers[0] ?? 1;
+const bench = S.bench_size;
+const active = S.roster_size - bench;
 const raw = (stats: Record<string, number>) => Object.entries(stats).reduce((t, [k, c]) => t + (S.stat_weights[k] ?? 0) * c, 0);
 const line = (stats: Record<string, number>) => Object.entries(stats).map(([k, c]) => `${c} ${statLabel(k)}`).join(', ');
 
@@ -48,12 +40,12 @@ export function RulesPage() {
       <article className="card">
         <h2>The year</h2>
         <ul>
-          <li>The league runs all year. The year is split into <strong>seasons</strong> of two or three weeks, each
-            ending at a tournament.</li>
-          <li>Each league has up to {S.max_members} teams. Every team plays one head-to-head matchup a week, all
-            year. Standings never reset between seasons.</li>
-          <li>Rosters are rebuilt every season in a fresh auction. Each roster holds {S.roster_size} players. There are
-            no trades.</li>
+          <li>The league runs all year. The year is split into <strong>seasons</strong>, and each season is one of our
+            tournaments.</li>
+          <li>Each league has up to {S.max_members} teams. Every game our team plays at the tournament, every fantasy
+            team plays one head-to-head matchup. Standings never reset between seasons.</li>
+          <li>Rosters are rebuilt every season in a fresh auction. Each roster holds {S.roster_size} players:{' '}
+            {active} active and {bench} on the bench. There are no trades.</li>
           <li>The team at the top of the year's standings wins a merch prize. There is no cash prize.</li>
         </ul>
       </article>
@@ -75,22 +67,39 @@ export function RulesPage() {
       </article>
 
       <article className="card">
-        <h2>Your weekly pick</h2>
+        <h2>Your game picks</h2>
         <ul>
-          <li>Each week you start <strong>one</strong> player from your roster. You can't start the same player twice
-            until you've used everyone on your roster that season.</li>
-          <li>Picks lock {LOCK_DAY[S.pick_lock_day]} at {clock(S.pick_lock_time)} (Eastern). Other teams' picks stay
-            hidden until then.</li>
-          <li>Forgot to pick? We start your best unused player (by their scores so far) for you.</li>
-          <li>If your pick is injured at the lock, we swap in your best unused healthy player, and you'll see a
-            notice. A week where your player was injured and didn't play doesn't use them up.</li>
+          <li>Each game you start <strong>one</strong> of your active players against one other fantasy team.</li>
+          <li>Opponents are paired Swiss style: teams close in the standings meet, and you don't play the same team
+            twice if it can be avoided. Each pairing is set when the game before it finishes.</li>
+          <li>Pick for the next game any time before it starts, even before you know your opponent. Picks lock when a
+            stat keeper starts the game. Other teams' picks stay hidden until then.</li>
+          <li>Forgot to pick, or your pick is injured or on your bench? We start your most rested active player (then
+            the one scoring best lately), and you'll see a notice.</li>
+          <li>Choose your bench before game 1 starts; if you don't, it's the player you paid least for. The bench plays
+            only if an active player gets injured: then you can swap it in for the rest of the season, once.</li>
         </ul>
+        <div className="section">
+          <h3>Tired players</h3>
+          <p>Starting a player in back-to-back games tires them. Rotating your {active} active players never does.</p>
+          <div className="table-wrap">
+            <table>
+              <thead><tr><th>You last started them</th><th>Their stats count</th></tr></thead>
+              <tbody>
+                {S.tiredness_multipliers.map((m, i) => (
+                  <tr key={i}><td>{i === 0 ? 'The game before' : `${i + 1} games before`}</td><td>×{n(m)}</td></tr>
+                ))}
+                <tr><td>Earlier, or not yet this season</td><td>×1</td></tr>
+              </tbody>
+            </table>
+          </div>
+        </div>
       </article>
 
       <article className="card">
         <h2>Scoring</h2>
-        <p>Your score is your player's stats from that week's practices and tournaments. Tournament stats count
-          ×{S.session_multipliers.tournament}.</p>
+        <p>Your score is your player's stats from that one game, ×{S.session_multipliers.tournament} for a
+          tournament. Practices aren't scored.</p>
         <div className="table-wrap">
           <table>
             <thead><tr><th>Stat</th><th>Points</th></tr></thead>
@@ -103,10 +112,9 @@ export function RulesPage() {
         </div>
         <div className="section">
           <h3>Example</h3>
-          <p>Practice: {line(practice)} = {n(raw(practice))}.</p>
-          <p>Tournament: {line(tournament)} = {n(raw(tournament))}, ×{S.session_multipliers.tournament} ={' '}
-            {n(raw(tournament) * S.session_multipliers.tournament)}.</p>
-          <p>Week score: <strong>{n(weekScore)}</strong>. The higher score wins the matchup.</p>
+          <p>{line(game)} = {n(raw(game))}, ×{S.session_multipliers.tournament} = {n(raw(game) * S.session_multipliers.tournament)}.</p>
+          <p>Game score: <strong>{n(gameScore)}</strong>. If you also started them the game before, it's{' '}
+            {n(gameScore)} × {n(tired)} = {n(gameScore * tired)}. The higher score wins the matchup.</p>
         </div>
         <p className="muted">A session's stats count {S.stat_lock_hours} hours after a stat keeper verifies them.</p>
       </article>
@@ -155,7 +163,7 @@ export function RulesPage() {
             fall beta.</p>
           <h3>Who can see what?</h3>
           <p>Your league sees rosters, results and every bid after the auction closes. Only you and the league staff
-            see your credit balance. Other teams can't see your pick until it locks.</p>
+            see your credit balance. Other teams can't see your pick until the game starts.</p>
           <h3>I'm a player. Can I opt out?</h3>
           <p>Yes. Tell a captain before the next auction opens. Players who opt out aren't listed or bid on in the next auction.</p>
           <h3>What if a stat is wrong?</h3>
```

- [ ] **Step 4: Run the tests and checks**

Run: `npx vitest run src && npx tsc -b && npx eslint .`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/pages/RulesPage.tsx src/app/pages/RulesPage.test.tsx
git commit -m "docs(rules): rules page for tournament play (tournament mode T3)"
```

---

### Task 6: Final verification and hand-off (controller, not a subagent)

- [ ] Final whole-branch review (opus) against the spec + this plan; fix wave if needed.
- [ ] Full checks: `npx tsc -b`, `npx eslint .`, `npm run build`, `npx vitest run src` (227), then alone
  `npx vitest run tests/db` (173). `git diff --stat main` should match `git diff --stat main t3-verified-draft`
  plus any review fixes.
- [ ] Visual check with the user on the preview (launch.json "tribe-fantasy"), **read-only** against the live DB:
  League tab at 375×812 (Tournament card: Game 1 pick list, bench, standings), Tally tab (the tournament card shows
  "Start game 1" only once a tournament is open; don't tap it), Admin → Stages (Open tournament button on the
  auctioned stage; don't tap it), Rules page. Anything that writes waits for the user's OK, ideally on a
  throwaway season.
- [ ] Go-live: no migration (0012 is live). With the user's OK: merge `tournament-app` into `main`, push, watch
  CI + Deploy, check the live bundle has the new code (`TournamentCard` strings), tag `m9-app`, push the tag.
  Delete `t3-verified-draft` and `tournament-app`. Taskboard: t83 done. `graphify update .`. Update memory.
- [ ] Timing: Oct 17–18 is the tally dry run. Shipping T3 before then means the dry run exercises Start/Finish
  (good, but it's a tally change before a tournament day); holding it means the dry run uses the old screen. The
  user decides; never deploy tally changes ON a tournament day.
- [ ] Next: T4 plan (retire weekly: migration dropping `weeks`/`picks` + weekly RPCs + old settings keys after the
  user confirms the 3 test weeks can go, `year.ts` retirement, `delete_athlete` counts, split `scoreTournaments`).
