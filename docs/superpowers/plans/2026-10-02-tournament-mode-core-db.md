# Tournament Mode — Core + Database (T1 + T2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pure scoring/pairing core and the database for tournament mode: games instead of weeks, one-on-one
per game, 3 active + 1 bench, Swiss pairing, pre-selected picks, rested-first auto-pick, tiredness, injury bench
swaps. No UI (that is plan T3 + T4).

**Architecture:** `src/core/tournament.ts` replays a league's year game by game from league-readable rows
(`scoreTournaments`), works out each roster's active/bench athletes (`lineup`), and proposes the next game's Swiss
pairings from provisional standings (`nextPairings`, `liveStatLines`). It reuses `scoreWeek`, `autoPick`,
`tirednessMultiplier`, `swissPairings` and `stageMultiplier`. The simulator plays tournament years so `npm run tune`
can sweep `upset_k` × tiredness. Migration `0012_tournament.sql` (additive) adds `games`, `game_pairings`,
`game_picks`, `bench_swaps`, `roster_slots.bench`, and six RPCs. The weekly code (`year.ts`, weeks/picks) stays
untouched until T4.

**Tech Stack:** TypeScript (pure core, zero deps), Supabase Postgres (RLS + security-definer RPCs), Vitest, PGlite.

**Spec:** `docs/superpowers/specs/2026-10-02-tournament-mode-design.md` — §2 rules, §4 data, §5 core, and
**Amendments 1–12** at the end (they override the body where they differ). Read it first.

## Global Constraints

- Every executor invokes `ponytail:ponytail` first (the user's standing rule): shortest correct diff, no new deps.
- node/npm are not on the Bash PATH: prefix commands with `export PATH="/c/Program Files/nodejs:$PATH";`.
- Branch `tournament-mode`. Never edit an applied migration (0001–0011). The new one is `0012_tournament.sql`.
- All writes go through security-definer RPCs with `set search_path = ''`; every state-changing RPC writes an audit
  row; staff RPCs check the role FIRST (the RPC gate calls every function with all-null args).
- Picks are sealed: audit rows for `set_game_pick` carry only `membership_id` and `number`, never the athlete.
- Tiredness default `[0.5, 0.75]`, `bench_size` 1 (already on the branch, commit 84968d9).
- A missing tiredness or multiplier for a picked athlete is a caller bug and throws (never a silent 1).
- DB tests time out when run alongside the dev server or other agents: run `npx vitest run tests/db` on its own.
- Never save season settings from a local preview against the live DB (amendment 9).
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  (or the executor's own model name).

## The verified draft

The full implementation was built and verified while planning: `tsc -b`, `eslint .`, `npm run build`, **210
app/core tests + 169 DB tests** green. It lives in `git stash` **"tournament-core-db-verified-draft"** on branch
`tournament-mode` (base cbcf3b7). Executors copy their task's files from it instead of retyping, then run the checks:

```bash
S=$(git stash list | grep tournament-core-db-verified-draft | cut -d: -f1)   # e.g. stash@{0}
git checkout "$S" -- <modified tracked file>                                 # files that already exist on the branch
git checkout "$S^3" -- <new file>                                            # files the draft creates
```

Never `git stash pop`/`apply` the whole stash, and never copy `.impeccable/` or `tsconfig.tsbuildinfo`. No file is
shared between tasks, so every copy is whole-file. Leave `stash@{1}` ("local-untracked-before-cloud-move") alone:
it is the user's. Reviewers compare each task's diff against the spec, not the stash.

## Review Focus

Inputs the spec implies that are most likely to bite real users, and the test that pins each:

1. **Two keepers tap Start or Finish at once** → the first wins, the second gets `GAME_STARTED` / `GAME_NOT_LIVE`,
   never a second session or a second game 2 → "starts a game … once" and "finishes a live game …" (Task 3).
2. **A pick for a benched, injured or missing athlete** → the scorer swaps in the most rested healthy active athlete
   with a notice (`inactive` / `injured` / `missed`) → "swaps out a pick injured at the start, and one that is not
   active" and "auto-picks a missed pick" (Task 1).
3. **A team that joins mid-tournament** → `finish_game` refuses pairings that leave them out
   (`PAIRINGS_INVALID`), and `nextPairings` includes everyone joined by now and gives an odd count one bye →
   "refuses pairings that miss…" (Task 3), "leaves out a team that joins after now…" (Task 1).
4. **A game's session deleted** (empty-delete or admin force-delete) → the game goes void: no points, no
   tiredness, later games not held back → "leaves the game void" (Task 3), "…a void game holds nothing" (Task 1).
5. **A short roster** (unfillable auction slots) → bench = `min(bench_size, roster − 1)`, so a 1-athlete roster has
   no bench and still plays → "always leaves an active athlete on a short roster" (Task 1), `setBench(carol, [])`
   and "fixes the default bench…" (Task 3).

Not testable in PGlite (single connection): a pick racing `start_game`. `set_game_pick` takes `for share` on the
stage's games so it waits for a concurrent start; reviewers check that line exists.

---

### Task 1: Tournament scorer and pairing (`src/core/tournament.ts`)

**Model:** sonnet (copy + verify; read the spec §2 and amendments 1–5 to review your own copy).

**Files:**
- Create: `src/core/tournament.ts`, `src/core/tournament.test.ts`
- Modify: `src/core/index.ts` (one export line)

**Interfaces:**
- Consumes (already on the branch): `autoPick(candidates, tiredness, history, s)` (picks.ts),
  `tirednessMultiplier(gap | null, s)` (tiredness.ts), `swissPairings(order, meetings)` + `meetingKey(a, b | null)`
  (swiss.ts), `scoreWeek` + `pairKey` (week.ts), `stageMultiplier` (decay.ts), `mergeTaps` (taps.ts),
  `YearMember`, `YearStatLine`, `YearInjury`, `YearStanding` (year.ts), `Pairing` (schedule.ts).
- Produces (T3's loader and screens rely on these exact names):
  - types `TournamentGame`, `TournamentPairing`, `TournamentSlot`, `TournamentPick`, `TournamentSwap`,
    `TournamentSession`, `TournamentInput` (with `currentStageId: string | null`), `GameStatus`
    (`'upcoming' | 'live' | 'pending' | 'final' | 'void'`), `GameNotice` (`'missed' | 'injured' | 'inactive'`),
    `TournamentSide`, `GameMatchup`, `GameOutcome`, `NextGame`, `TournamentResult`.
  - `scoreTournaments(input, opts?: { provisional?: boolean }): TournamentResult`
  - `lineup(input: Pick<TournamentInput, 'settings' | 'slots' | 'swaps'>, membershipId, stageId, number): { active: string[]; bench: string[] }`
  - `liveStatLines(sessionId, taps: Tap[], s): YearStatLine[]`
  - `nextPairings(input: TournamentInput): Pairing[]`

- [ ] **Step 1: Write the failing test** — copy `src/core/tournament.test.ts` from `$S^3` (full content below).

```ts
import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { lineup, liveStatLines, nextPairings, scoreTournaments, type TournamentGame, type TournamentInput } from './tournament';
import type { YearStatLine } from './year';

// Fixed points (upset_k 0: win +3, loss −1), 1 point per goal, no tournament doubling: easy arithmetic.
const s = parseSettings({ upset_k: 0, stat_weights: { goal: 1 }, session_multipliers: { tournament: 1 } });
const T0 = Date.parse('2026-11-07T14:00:00Z');
const H = 3_600_000;
const NOW = Date.parse('2027-01-01T00:00:00Z'); // every session locked
const iso = (t: number) => new Date(t).toISOString();

/** Game `n` of `stage`: started at T0 + (stage offset + n) hours, finished an hour later, session verified then. */
const game = (n: number, stage = 'S1', over: Partial<TournamentGame> = {}): TournamentGame => {
  const start = T0 + (stage === 'S1' ? 0 : 30 * 24) * H + 2 * n * H;
  return { id: `${stage}g${n}`, stageId: stage, number: n, sessionId: `${stage}s${n}`, startedAt: iso(start),
    finishedAt: iso(start + H), ...over };
};
const verifiedAt = (g: TournamentGame) => g.finishedAt;
const goals = (sessionId: string, athleteId: string, n: number): YearStatLine =>
  ({ sessionId, athleteId, stats: { goal: n }, pointsPlayed: 0 });
const roster = (stageId: string, m: string, ids: string[], prices = [10, 20, 30, 5]) =>
  ids.map((athleteId, i) => ({ stageId, membershipId: m, athleteId, price: prices[i], bench: false }));

/** Two teams, three games of S1. m1 roster a1–a4 (a4 cheapest = bench), m2 b1–b4 (b4 bench). */
const base = (over: Partial<TournamentInput> = {}): TournamentInput => {
  const games = over.games ?? [game(1), game(2), game(3)];
  return {
    settings: s,
    now: NOW,
    games,
    pairings: games.map((g) => ({ gameId: g.id, home: 'm1', away: 'm2' })),
    members: [{ id: 'm1', createdAt: '2026-10-01T00:00:00Z' }, { id: 'm2', createdAt: '2026-10-01T00:00:00Z' }],
    slots: [...roster('S1', 'm1', ['a1', 'a2', 'a3', 'a4']), ...roster('S1', 'm2', ['b1', 'b2', 'b3', 'b4'])],
    picks: [
      { stageId: 'S1', number: 1, membershipId: 'm1', athleteId: 'a1' }, { stageId: 'S1', number: 1, membershipId: 'm2', athleteId: 'b1' },
      { stageId: 'S1', number: 2, membershipId: 'm1', athleteId: 'a2' }, { stageId: 'S1', number: 2, membershipId: 'm2', athleteId: 'b2' },
      { stageId: 'S1', number: 3, membershipId: 'm1', athleteId: 'a3' }, { stageId: 'S1', number: 3, membershipId: 'm2', athleteId: 'b3' },
    ],
    swaps: [],
    sessions: games.filter((g) => g.sessionId !== null).map((g) => ({ id: g.sessionId!, verifiedAt: verifiedAt(g) })),
    statLines: [
      goals('S1s1', 'a1', 4), goals('S1s1', 'b1', 2),
      goals('S1s2', 'a2', 1), goals('S1s2', 'b2', 3),
      goals('S1s3', 'a3', 2), goals('S1s3', 'b3', 2),
    ],
    injuries: [],
    currentStageId: null,
    ...over,
  };
};
const side = (r: ReturnType<typeof scoreTournaments>, gameId: string, m: string) => {
  const mt = r.games.find((g) => g.game.id === gameId)!.matchups.find((x) => x.home.membershipId === m || x.away?.membershipId === m)!;
  return mt.home.membershipId === m ? mt.home : mt.away!;
};
const pick = (number: number, membershipId: string, athleteId: string, stageId = 'S1') => ({ stageId, number, membershipId, athleteId });

describe('scoreTournaments', () => {
  it('scores final games in order and keeps a W-L-T table', () => {
    const r = scoreTournaments(base());
    expect(r.games.map((g) => g.status)).toEqual(['final', 'final', 'final']);
    expect(side(r, 'S1g1', 'm1')).toMatchObject({ athleteId: 'a1', notice: null, tired: 1, decay: 1, score: 4, delta: 3, result: 'W' });
    expect(side(r, 'S1g2', 'm1')).toMatchObject({ score: 1, delta: -1, result: 'L' });
    expect(side(r, 'S1g3', 'm1')).toMatchObject({ result: 'T', delta: 1 });
    expect(r.standings.find((x) => x.membershipId === 'm1')).toMatchObject({ points: 3, wins: 1, losses: 1, ties: 1, totalScore: 7 });
    expect(r.standings.find((x) => x.membershipId === 'm2')).toMatchObject({ points: 3, wins: 1, losses: 1, ties: 1 });
  });

  it('plays games in start order, whatever order the rows come in', () => {
    const r = base();
    expect(scoreTournaments({ ...r, games: [...r.games].reverse() })).toEqual(scoreTournaments(r));
  });

  it('halves a repeat right after a start, ×0.75 two games on, rested after that (spec §2)', () => {
    const games = [game(1), game(2), game(3), game(4)];
    const r = scoreTournaments(base({
      games,
      pairings: games.map((g) => ({ gameId: g.id, home: 'm1', away: 'm2' })),
      sessions: games.map((g) => ({ id: g.sessionId!, verifiedAt: verifiedAt(g) })),
      picks: [pick(1, 'm1', 'a1'), pick(2, 'm1', 'a1'), pick(3, 'm1', 'a2'), pick(4, 'm1', 'a1'),
        pick(1, 'm2', 'b1'), pick(2, 'm2', 'b2'), pick(3, 'm2', 'b3'), pick(4, 'm2', 'b1')],
      statLines: games.flatMap((g) => [goals(g.sessionId!, 'a1', 4), goals(g.sessionId!, 'a2', 4)]),
    }));
    expect([1, 2, 4].map((n) => side(r, `S1g${n}`, 'm1').tired)).toEqual([1, 0.5, 0.75]);
    expect(side(r, 'S1g2', 'm1')).toMatchObject({ athleteScore: 4, score: 2 });
    expect(side(r, 'S1g4', 'm2').tired).toBe(1); // cycling all three actives never tires (gap 3)
  });

  it('auto-picks a missed pick: the most rested active athlete, even over a better recent average', () => {
    const r = scoreTournaments(base({ picks: base().picks.filter((p) => !(p.number === 2 && p.membershipId === 'm1')) }));
    // a1 started game 1 (×0.5); a2 and a3 are rested and have no history: lowest id.
    expect(side(r, 'S1g2', 'm1')).toMatchObject({ picked: null, athleteId: 'a2', notice: 'missed', tired: 1 });
  });

  it('swaps out a pick injured at the start, and one that is not active (the bench)', () => {
    const injured = scoreTournaments(base({
      injuries: [{ athleteId: 'a2', confirmedAt: iso(T0), clearedAt: null }],
    }));
    expect(side(injured, 'S1g2', 'm1')).toMatchObject({ picked: 'a2', athleteId: 'a3', notice: 'injured' });
    const benched = scoreTournaments(base({ picks: [...base().picks.filter((p) => p.number !== 1), pick(1, 'm1', 'a4'), pick(1, 'm2', 'b1')] }));
    expect(side(benched, 'S1g1', 'm1')).toMatchObject({ picked: 'a4', athleteId: 'a1', notice: 'inactive' });
  });

  it('ignores an injury confirmed after the start', () => {
    const r = scoreTournaments(base({ injuries: [{ athleteId: 'a2', confirmedAt: iso(T0 + 4.5 * H), clearedAt: null }] }));
    expect(side(r, 'S1g2', 'm1')).toMatchObject({ athleteId: 'a2', notice: null });
  });

  it('forfeits when every active athlete is gone and default_pick is forfeit', () => {
    const r = scoreTournaments(base({
      settings: { ...s, default_pick: 'forfeit' },
      picks: base().picks.filter((p) => !(p.number === 1 && p.membershipId === 'm1')),
    }));
    expect(side(r, 'S1g1', 'm1')).toMatchObject({ athleteId: null, tired: null, decay: null, score: 0, result: 'L' });
  });

  it('holds later games back behind a live or pending one; a void game holds nothing and scores nothing', () => {
    const live = base({ games: [game(1), game(2, 'S1', { finishedAt: null }), game(3)] });
    live.sessions = live.sessions.map((x) => (x.id === 'S1s2' ? { ...x, verifiedAt: null } : x));
    expect(scoreTournaments(live).games.map((g) => g.status)).toEqual(['final', 'live', 'pending']);

    const pending = base();
    pending.sessions = pending.sessions.map((x) => (x.id === 'S1s1' ? { ...x, verifiedAt: iso(NOW - H) } : x));
    expect(scoreTournaments(pending).games.map((g) => g.status)).toEqual(['pending', 'pending', 'pending']);

    const v = scoreTournaments(base({ games: [game(1), game(2, 'S1', { sessionId: null }), game(3)] }));
    expect(v.games.map((g) => g.status)).toEqual(['final', 'void', 'final']);
    expect(side(v, 'S1g2', 'm1').delta).toBeNull();
    // a1 started game 1; game 2 was void, so a1 in game 3 is two games on, not one.
    const again = scoreTournaments(base({
      games: [game(1), game(2, 'S1', { sessionId: null }), game(3)],
      picks: [...base().picks.filter((p) => p.number !== 3), pick(3, 'm1', 'a2'), pick(3, 'm2', 'b3')],
    }));
    expect(side(again, 'S1g3', 'm1').tired).toBe(1); // a2's game-2 start was void, so it doesn't count
  });

  it('marks a not-started game upcoming and resolves its picks as of now', () => {
    const r = scoreTournaments(base({ games: [game(1), game(2), game(3), game(4, 'S1', { sessionId: null, startedAt: null, finishedAt: null })],
      pairings: [1, 2, 3, 4].map((n) => ({ gameId: `S1g${n}`, home: 'm1', away: 'm2' })) }));
    expect(r.games.at(-1)!.status).toBe('upcoming');
    expect(side(r, 'S1g4', 'm1')).toMatchObject({ picked: null, notice: 'missed', athleteId: 'a1', score: null });
    expect(side(r, 'S1g4', 'm1').rest).toEqual({ a1: 1, a2: 0.75, a3: 0.5 });
  });

  it('counts a finished game as final only when provisional', () => {
    const b = base();
    b.sessions = b.sessions.map((x) => ({ ...x, verifiedAt: null }));
    expect(scoreTournaments(b).games.map((g) => g.status)).toEqual(['pending', 'pending', 'pending']);
    const p = scoreTournaments(b, { provisional: true });
    expect(p.games.map((g) => g.status)).toEqual(['final', 'final', 'final']);
    expect(p.standings.find((x) => x.membershipId === 'm1')!.points).toBe(3);
  });

  it('degrades a pair started in an earlier tournament (stage decay, grace 0)', () => {
    const g = [game(1), game(1, 'S2')];
    const r = scoreTournaments(base({
      settings: { ...s, decay_grace_stages: 0 },
      games: g,
      pairings: g.map((x) => ({ gameId: x.id, home: 'm1', away: 'm2' })),
      sessions: g.map((x) => ({ id: x.sessionId!, verifiedAt: verifiedAt(x) })),
      slots: [...base().slots, ...roster('S2', 'm1', ['a1', 'a2', 'a3', 'a4']), ...roster('S2', 'm2', ['b1', 'b2', 'b3', 'b4'])],
      picks: [pick(1, 'm1', 'a1'), pick(1, 'm2', 'b1'), pick(1, 'm1', 'a1', 'S2'), pick(1, 'm2', 'b2', 'S2')],
      statLines: [goals('S2s1', 'a1', 10)],
    }));
    // Tiredness resets each tournament; the earlier tournament's start costs ×0.9.
    expect(side(r, 'S2g1', 'm1')).toMatchObject({ tired: 1, decay: 0.9, score: 9 });
    expect(side(r, 'S2g1', 'm2').decay).toBe(1);
  });

  it('describes the next game of the current stage, with pre-selected picks and tiredness', () => {
    const r = scoreTournaments(base({ currentStageId: 'S1', picks: [...base().picks, pick(4, 'm1', 'a3')] }));
    expect(r.next).toMatchObject({ stageId: 'S1', number: 4 });
    expect(r.next!.sides.find((x) => x.membershipId === 'm1')).toMatchObject({
      picked: 'a3', athleteId: 'a3', tired: 0.5, rest: { a1: 1, a2: 0.75, a3: 0.5 }, bench: ['a4'],
    });
    const before = scoreTournaments(base({ games: [], pairings: [], currentStageId: 'S1' }));
    expect(before.next).toMatchObject({ number: 1 });
    expect(before.next!.sides.map((x) => x.membershipId)).toEqual(['m1', 'm2']);
  });
});

describe('lineup', () => {
  const input = (over: Partial<Pick<TournamentInput, 'settings' | 'slots' | 'swaps'>> = {}) =>
    ({ settings: s, slots: roster('S1', 'm1', ['a1', 'a2', 'a3', 'a4']), swaps: [], ...over });

  it('benches the cheapest athlete by default (ties → lowest id) and honours a choice', () => {
    expect(lineup(input(), 'm1', 'S1', 1)).toEqual({ active: ['a1', 'a2', 'a3'], bench: ['a4'] });
    expect(lineup(input({ slots: roster('S1', 'm1', ['a2', 'a1'], [5, 5]) }), 'm1', 'S1', 1).bench).toEqual(['a1']);
    const chosen = roster('S1', 'm1', ['a1', 'a2', 'a3', 'a4']).map((x) => ({ ...x, bench: x.athleteId === 'a2' }));
    expect(lineup(input({ slots: chosen }), 'm1', 'S1', 1)).toEqual({ active: ['a1', 'a3', 'a4'], bench: ['a2'] });
  });

  it('always leaves an active athlete on a short roster', () => {
    expect(lineup(input({ slots: roster('S1', 'm1', ['a1']) }), 'm1', 'S1', 1)).toEqual({ active: ['a1'], bench: [] });
    expect(lineup(input({ slots: [] }), 'm1', 'S1', 1)).toEqual({ active: [], bench: [] });
  });

  it('applies a bench swap from its game on', () => {
    const swaps = [{ stageId: 'S1', membershipId: 'm1', outAthlete: 'a2', inAthlete: 'a4', fromGame: 3 }];
    expect(lineup(input({ swaps }), 'm1', 'S1', 2).active).toEqual(['a1', 'a2', 'a3']);
    expect(lineup(input({ swaps }), 'm1', 'S1', 3)).toEqual({ active: ['a1', 'a3', 'a4'], bench: ['a2'] });
  });
});

describe('nextPairings', () => {
  const four = (over: Partial<TournamentInput> = {}) => {
    const g1 = game(1);
    return base({
      games: [g1],
      pairings: [{ gameId: g1.id, home: 'm1', away: 'm2' }, { gameId: g1.id, home: 'm3', away: 'm4' }],
      members: ['m1', 'm2', 'm3', 'm4'].map((id) => ({ id, createdAt: '2026-10-01T00:00:00Z' })),
      slots: [...roster('S1', 'm1', ['a1']), ...roster('S1', 'm2', ['b1']), ...roster('S1', 'm3', ['c1']), ...roster('S1', 'm4', ['d1'])],
      picks: [],
      sessions: [{ id: g1.sessionId!, verifiedAt: null }],
      statLines: [goals('S1s1', 'a1', 5), goals('S1s1', 'b1', 1), goals('S1s1', 'c1', 1), goals('S1s1', 'd1', 4)],
      now: Date.parse(g1.finishedAt!),
      ...over,
    });
  };

  it('pairs winners with winners on provisional results, avoiding rematches', () => {
    // m1 and m4 won game 1 (unverified): they meet; m2 and m3 meet.
    expect(nextPairings(four())).toEqual([['m1', 'm4'], ['m2', 'm3']]);
  });

  it('leaves out a team that joins after now, and gives an odd count a bye', () => {
    const f = four();
    const late = nextPairings({ ...f, members: [...f.members, { id: 'm5', createdAt: '2027-06-01T00:00:00Z' }] });
    expect(late.flat()).not.toContain('m5');
    const joined = nextPairings({ ...f, members: [...f.members, { id: 'm5', createdAt: '2026-10-02T00:00:00Z' }] });
    // m5 (0 points, never paired) ties the losers; the lowest-placed team without a bye sits out.
    expect(joined).toHaveLength(3);
    expect(joined.filter(([, b]) => b === null)).toHaveLength(1);
    expect(joined.flat().filter((x) => x !== null).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('ignores pairings of a game that never started', () => {
    const ghost = game(2, 'S1', { sessionId: null, startedAt: null, finishedAt: null });
    const f = four();
    const r = nextPairings({ ...f, games: [...f.games, ghost],
      pairings: [...f.pairings, { gameId: ghost.id, home: 'm1', away: 'm4' }, { gameId: ghost.id, home: 'm2', away: 'm3' }] });
    expect(r).toEqual([['m1', 'm4'], ['m2', 'm3']]);
  });
});

describe('liveStatLines', () => {
  it('turns merged live taps into stat lines (two keepers within the window count once)', () => {
    const t = (id: string, keeperId: string, at: number, undoes: string | null = null) =>
      ({ id, athleteId: 'a1', stat: 'goal', keeperId, tappedAt: at, undoes });
    expect(liveStatLines('s1', [t('1', 'k1', 0), t('2', 'k2', 2000), t('3', 'k1', 60_000), t('4', 'k1', 61_000, '3')], s))
      .toEqual([{ sessionId: 's1', athleteId: 'a1', stats: { goal: 1 }, pointsPlayed: 0 }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/core/tournament.test.ts`
Expected: FAIL — cannot resolve `./tournament`.

- [ ] **Step 3: Implement** — copy `src/core/tournament.ts` from `$S^3` (full content below) and add the export.

```ts
import { stageMultiplier } from './decay';
import { autoPick } from './picks';
import { rankSnapshot, TIE_EPSILON } from './points';
import type { Pairing } from './schedule';
import { athleteWeekScore, type StatLine } from './scoring';
import type { SeasonSettings } from './settings';
import { meetingKey, swissPairings } from './swiss';
import { mergeTaps, type Tap } from './taps';
import { tirednessMultiplier } from './tiredness';
import { pairKey, scoreWeek, type SideResult } from './week';
import type { YearInjury, YearMember, YearStanding, YearStatLine } from './year';

/** One row of public.games. Times are ISO. */
export interface TournamentGame {
  id: string;
  stageId: string;
  number: number;
  sessionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}
export interface TournamentPairing { gameId: string; home: string; away: string | null }
export interface TournamentSlot { stageId: string; membershipId: string; athleteId: string; price: number; bench: boolean }
/** Keyed by game number, not game id: a pick can exist before its game does (pre-selection). */
export interface TournamentPick { stageId: string; number: number; membershipId: string; athleteId: string }
export interface TournamentSwap { stageId: string; membershipId: string; outAthlete: string; inAthlete: string; fromGame: number }
export interface TournamentSession { id: string; verifiedAt: string | null }

/** Everything for ONE league of one season. `now` is epoch ms. */
export interface TournamentInput {
  settings: SeasonSettings;
  now: number;
  games: TournamentGame[];
  pairings: TournamentPairing[];
  members: YearMember[];
  slots: TournamentSlot[];
  picks: TournamentPick[];
  swaps: TournamentSwap[];
  sessions: TournamentSession[];
  statLines: YearStatLine[];
  injuries: YearInjury[];
  /** The stage whose next game `next` describes (the pick screen's stage); null = no `next`. */
  currentStageId: string | null;
}

/**
 * upcoming: paired, not started. live: started, not finished. pending: waiting on locked stats or an earlier game.
 * void: started but its session was deleted (scores nothing, holds nothing back).
 */
export type GameStatus = 'upcoming' | 'live' | 'pending' | 'final' | 'void';
/** Why the athlete who plays isn't the manager's own pick. */
export type GameNotice = 'missed' | 'injured' | 'inactive';

export interface TournamentSide {
  membershipId: string;
  /** The manager's pick as made; null if none (or sealed: others' picks are hidden until the game starts). */
  picked: string | null;
  /** Who plays (or would, if the game started now). Null = forfeit. */
  athleteId: string | null;
  notice: GameNotice | null;
  active: string[];
  bench: string[];
  /** Tiredness factor per active athlete for this game. */
  rest: Record<string, number>;
  /** Factors for `athleteId`; null on a forfeit. */
  tired: number | null;
  decay: number | null;
  /** Set on final games only. */
  athleteScore: number | null;
  score: number | null;
  delta: number | null;
  result: 'W' | 'L' | 'T' | null;
}
export interface GameMatchup { home: TournamentSide; away: TournamentSide | null }
export interface GameOutcome { game: TournamentGame; status: GameStatus; matchups: GameMatchup[] }
export interface NextGame { stageId: string; number: number; sides: TournamentSide[] }
export interface TournamentResult { games: GameOutcome[]; standings: YearStanding[]; next: NextGame | null }

const ms = Date.parse;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Tournament mode §2: plays the league's year game by game from league-readable rows. Pure and deterministic.
 * `provisional`: a finished game counts as final whatever its stats' lock (for pairing only, never shown).
 */
export function scoreTournaments(input: TournamentInput, opts: { provisional?: boolean } = {}): TournamentResult {
  const s = input.settings;
  const { now } = input;
  const lockMs = s.stat_lock_hours * 3_600_000;
  const sessions = new Map(input.sessions.map((x) => [x.id, x]));
  const isLocked = (id: string) => {
    const v = sessions.get(id)?.verifiedAt ?? null;
    return v !== null && ms(v) + lockMs <= now;
  };
  // Started games in the order they were played, then the ones not started yet.
  const games = [...input.games].sort((a, b) =>
    a.startedAt !== null && b.startedAt !== null ? ms(a.startedAt) - ms(b.startedAt) || a.number - b.number
      : a.startedAt !== null ? -1 : b.startedAt !== null ? 1 : a.number - b.number || cmp(a.id, b.id));

  const linesBySession = new Map<string, StatLine[]>();
  for (const l of input.statLines) {
    const list = linesBySession.get(l.sessionId) ?? [];
    list.push({ athleteId: l.athleteId, sessionType: 'tournament', pointsPlayed: l.pointsPlayed, stats: l.stats });
    linesBySession.set(l.sessionId, list);
  }
  const injuredAt = (a: string, at: number) => input.injuries.some(
    (i) => i.athleteId === a && ms(i.confirmedAt) <= at && (i.clearedAt === null || ms(i.clearedAt) > at));

  // Auto-pick history: game scores from games final on their own locked stats, by when they settled (as M6).
  const settled: { settledAt: number; scores: Record<string, number> }[] = [];
  const athletes = [...new Set(input.slots.map((x) => x.athleteId))].sort();
  const historyAsOf = (asOf: number): Record<string, number[]> => {
    const h: Record<string, number[]> = {};
    for (const e of settled) if (e.settledAt <= asOf) for (const a of athletes) (h[a] ??= []).push(e.scores[a]);
    return h;
  };

  const lastStart = new Map<string, number>(); // `${stage}:${membership}:${athlete}` → game number
  const startedIn = new Map<string, Set<string>>(); // pairKey → stages with a start
  const table = new Map(input.members.map((m) => [m.id, { points: 0, totalScore: 0, wins: 0, losses: 0, ties: 0 }]));

  /** One manager's side of game `number` in `stageId`, as of `asOf`. */
  const sideOf = (membershipId: string, stageId: string, number: number, asOf: number): TournamentSide => {
    const { active, bench } = lineup(input, membershipId, stageId, number);
    const rest: Record<string, number> = {};
    for (const a of active) {
      const last = lastStart.get(`${stageId}:${membershipId}:${a}`);
      rest[a] = tirednessMultiplier(last === undefined ? null : number - last, s);
    }
    const picked = input.picks.find((p) => p.stageId === stageId && p.number === number && p.membershipId === membershipId)
      ?.athleteId ?? null;
    let athleteId = picked;
    let notice: GameNotice | null = null;
    if (picked === null || !active.includes(picked) || injuredAt(picked, asOf)) {
      notice = picked === null ? 'missed' : active.includes(picked) ? 'injured' : 'inactive';
      const healthy = active.filter((a) => !injuredAt(a, asOf));
      athleteId = autoPick(healthy.length > 0 ? healthy : active, rest, historyAsOf(asOf), s);
    }
    const stages = athleteId === null ? null : startedIn.get(pairKey(membershipId, athleteId)) ?? new Set<string>();
    return {
      membershipId, picked, athleteId, notice, active, bench, rest,
      tired: athleteId === null ? null : rest[athleteId],
      decay: stages === null ? null : stageMultiplier([...stages].filter((x) => x !== stageId).length, s),
      athleteScore: null, score: null, delta: null, result: null,
    };
  };

  let blocked = false;
  const outcomes: GameOutcome[] = games.map((g) => {
    const sessionGone = g.sessionId === null || !sessions.has(g.sessionId);
    let status: GameStatus =
      g.startedAt === null ? 'upcoming'
        : sessionGone ? 'void'
          : isLocked(g.sessionId!) || (opts.provisional && g.finishedAt !== null) ? 'final'
            : g.finishedAt === null ? 'live' : 'pending';
    const ownFinal = status !== 'void' && g.sessionId !== null && isLocked(g.sessionId);
    if (status === 'final' && blocked) status = 'pending';
    if (status === 'live' || status === 'pending') blocked = true;

    const asOf = g.startedAt === null ? now : ms(g.startedAt);
    const pairings = input.pairings.filter((p) => p.gameId === g.id)
      .sort((a, b) => cmp(a.home, b.home));
    const sides = new Map<string, TournamentSide>();
    for (const p of pairings) {
      for (const m of [p.home, p.away]) if (m !== null) sides.set(m, sideOf(m, g.stageId, g.number, asOf));
    }

    // A start counts for tiredness and degradation whatever happened in the game (spec §2), unless void.
    if (status !== 'upcoming' && status !== 'void') {
      for (const side of sides.values()) {
        if (side.athleteId === null) continue;
        lastStart.set(`${g.stageId}:${side.membershipId}:${side.athleteId}`, g.number);
        const key = pairKey(side.membershipId, side.athleteId);
        startedIn.set(key, (startedIn.get(key) ?? new Set()).add(g.stageId));
      }
    }

    if (status === 'final') {
      const lines = linesBySession.get(g.sessionId!) ?? [];
      const members = input.members.filter((m) => ms(m.createdAt) <= asOf || sides.has(m.id)).map((m) => m.id).sort();
      const multipliers: Record<string, number> = {};
      for (const x of sides.values()) {
        if (x.athleteId !== null) multipliers[pairKey(x.membershipId, x.athleteId)] = x.tired! * x.decay!;
      }
      const r = scoreWeek({
        settings: s,
        matchups: pairings.map((p, j) => ({ id: `${g.id}:${j}`, home: p.home, away: p.away })),
        picks: Object.fromEntries([...sides.values()].map((x) => [x.membershipId, x.athleteId])),
        statLines: lines,
        multipliers,
        standings: members.map((m) => ({ managerId: m, points: table.get(m)!.points, totalScore: table.get(m)!.totalScore })),
      });
      const apply = (sr: SideResult, other: SideResult | null) => {
        const result = other === null ? null
          : Math.abs(sr.score - other.score) < TIE_EPSILON ? 'T' : sr.score > other.score ? 'W' : 'L';
        Object.assign(sides.get(sr.managerId)!, { athleteScore: sr.athleteScore, score: sr.score, delta: sr.delta, result });
        const row = table.get(sr.managerId)!;
        const after = r.standings.find((x) => x.managerId === sr.managerId)!;
        row.points = after.points;
        row.totalScore = after.totalScore;
        if (result === 'W') row.wins++;
        if (result === 'L') row.losses++;
        if (result === 'T') row.ties++;
      };
      for (const mt of r.matchups) {
        apply(mt.home, mt.away);
        if (mt.away) apply(mt.away, mt.home);
      }
    }
    if (ownFinal) {
      const lines = linesBySession.get(g.sessionId!) ?? [];
      const scores: Record<string, number> = {};
      for (const a of athletes) scores[a] = athleteWeekScore(lines.filter((l) => l.athleteId === a), s);
      settled.push({ settledAt: ms(sessions.get(g.sessionId!)!.verifiedAt!) + lockMs, scores });
    }

    const matchups = pairings.map((p) => ({ home: sides.get(p.home)!, away: p.away === null ? null : sides.get(p.away)! }));
    return { game: g, status, matchups };
  });

  let next: NextGame | null = null;
  if (input.currentStageId !== null) {
    const stageId = input.currentStageId;
    const number = 1 + Math.max(0, ...input.games.filter((g) => g.stageId === stageId && g.startedAt !== null).map((g) => g.number));
    const withRoster = [...new Set(input.slots.filter((x) => x.stageId === stageId).map((x) => x.membershipId))].sort();
    next = { stageId, number, sides: withRoster.map((m) => sideOf(m, stageId, number, now)) };
  }

  const rows = [...table.entries()].map(([managerId, r]) => ({ managerId, ...r }));
  const ranks = rankSnapshot(rows);
  const standings = rows.map((r) => ({
    membershipId: r.managerId, points: r.points, totalScore: r.totalScore, wins: r.wins, losses: r.losses, ties: r.ties,
    rank: ranks[r.managerId],
    place: 1 + rows.filter((o) => o.points > r.points || (o.points === r.points && o.totalScore > r.totalScore)).length,
    tied: rows.some((o) => o !== r && o.points === r.points && o.totalScore === r.totalScore),
  })).sort((a, b) => a.rank - b.rank || cmp(a.membershipId, b.membershipId));
  return { games: outcomes, standings, next };
}

/**
 * Active and bench athletes of one manager for game `number`. Bench = the flagged slots when they number
 * min(bench_size, roster − 1), else the cheapest (ties → lowest id). A swap from game ≤ `number` trades places.
 */
export function lineup(input: Pick<TournamentInput, 'settings' | 'slots' | 'swaps'>, membershipId: string, stageId: string,
  number: number): { active: string[]; bench: string[] } {
  const slots = input.slots.filter((x) => x.stageId === stageId && x.membershipId === membershipId);
  const size = Math.min(input.settings.bench_size, Math.max(0, slots.length - 1));
  const flagged = slots.filter((x) => x.bench);
  let bench = (flagged.length === size ? flagged
    : [...slots].sort((a, b) => a.price - b.price || cmp(a.athleteId, b.athleteId)).slice(0, size)).map((x) => x.athleteId);
  let active = slots.map((x) => x.athleteId).filter((a) => !bench.includes(a));
  for (const w of input.swaps) {
    if (w.stageId !== stageId || w.membershipId !== membershipId || w.fromGame > number) continue;
    if (!active.includes(w.outAthlete) || !bench.includes(w.inAthlete)) continue;
    active = [...active.filter((a) => a !== w.outAthlete), w.inAthlete];
    bench = [...bench.filter((a) => a !== w.inAthlete), w.outAthlete];
  }
  return { active: active.sort(), bench: bench.sort() };
}

/** Stat lines from a session's live taps (merged as on the tally screen), for provisional standings. */
export function liveStatLines(sessionId: string, taps: Tap[], s: SeasonSettings): YearStatLine[] {
  const { counts } = mergeTaps(taps, s.tap_merge_seconds);
  return Object.entries(counts).sort(([a], [b]) => cmp(a, b))
    .map(([athleteId, stats]) => ({ sessionId, athleteId, stats, pointsPlayed: 0 }));
}

/**
 * Swiss pairings for the league's next game (spec §2): provisional standings, then `swissPairings` over the
 * members who have joined by `now`, counting meetings (and byes) in every started game of the year.
 * Callers pass verified lines where they exist and `liveStatLines` otherwise.
 */
export function nextPairings(input: TournamentInput): Pairing[] {
  const r = scoreTournaments(input, { provisional: true });
  const present = new Set(input.members.filter((m) => ms(m.createdAt) <= input.now).map((m) => m.id));
  const order = r.standings.filter((x) => present.has(x.membershipId))
    .sort((a, b) => b.points - a.points || b.totalScore - a.totalScore || cmp(a.membershipId, b.membershipId))
    .map((x) => x.membershipId);
  const started = new Set(input.games.filter((g) => g.startedAt !== null).map((g) => g.id));
  const meetings: Record<string, number> = {};
  for (const p of input.pairings) {
    if (!started.has(p.gameId)) continue;
    const k = meetingKey(p.home, p.away);
    meetings[k] = (meetings[k] ?? 0) + 1;
  }
  return swissPairings(order, meetings);
}
```

`src/core/index.ts`:

```diff
diff --git a/src/core/index.ts b/src/core/index.ts
index dd92207..ab9bfa1 100644
--- a/src/core/index.ts
+++ b/src/core/index.ts
@@ -12,3 +12,4 @@ export * from './taps';
 export * from './year';
 export * from './tiredness';
 export * from './swiss';
+export * from './tournament';
```

- [ ] **Step 4: Run the tests and checks**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/core && npx tsc -b && npx eslint src/core`
Expected: all core tests pass (19 in tournament.test.ts), no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/tournament.ts src/core/tournament.test.ts src/core/index.ts
git commit -m "feat(core): tournament scorer, lineup and Swiss next pairings (tournament mode T1)"
```

---

### Task 2: Simulator and tuning sweep play tournaments

**Model:** haiku (pure transcription; the code is complete below).

**Files:**
- Modify: `src/core/simulate.ts`, `src/core/simulate.test.ts`, `scripts/tune.ts` (whole-file replacements)

**Interfaces:**
- Consumes: `scoreTournaments`, `nextPairings`, `TournamentInput`, `TournamentResult` (Task 1); `allocate`,
  `fillLeftovers`, `stageAllowance`, `hashSeed`, `mulberry32`, `parseSettings` (existing).
- Produces: `simulateYear(cfg: YearSimConfig): YearSimResult` with `YearSimConfig = { managers, athletes, stages,
  gamesPerStage, seed, settings?, tanker?, repeater? }` and `YearSimResult.input: TournamentInput`,
  `.result: TournamentResult`. Only `scripts/tune.ts` and the sim test use it.

- [ ] **Step 1: Write the failing test** — copy `src/core/simulate.test.ts` from `$S`.

```ts
import { describe, expect, it } from 'vitest';
import { simulateYear } from './simulate';

const cfg = { managers: 6, athletes: 24, stages: 3, gamesPerStage: 5, seed: 'test' };
const sidesOf = (r: ReturnType<typeof simulateYear>) =>
  r.result.games.flatMap((g) => g.matchups.flatMap((m) => [m.home, m.away!]));

describe('simulateYear', () => {
  const r = simulateYear(cfg);

  it('plays every game of every tournament to a final result, three matchups each', () => {
    expect(r.result.games).toHaveLength(15);
    expect(r.result.games.every((g) => g.status === 'final' && g.matchups.length === 3)).toBe(true);
    expect(r.placesByStage).toHaveLength(3);
  });

  it('deals full, exclusive rosters each tournament with one bench athlete per team', () => {
    for (const st of ['s00', 's01', 's02']) {
      const slots = r.input.slots.filter((x) => x.stageId === st);
      expect(slots).toHaveLength(24);
      expect(new Set(slots.map((x) => x.athleteId)).size).toBe(24);
      expect(slots.filter((x) => x.bench)).toHaveLength(6);
    }
  });

  it('keeps standings points equal to the sum of game deltas', () => {
    for (const row of r.result.standings) {
      const sum = sidesOf(r).filter((x) => x.membershipId === row.membershipId).reduce((acc, x) => acc + (x.delta ?? 0), 0);
      expect(row.points).toBeCloseTo(sum);
    }
  });

  it('avoids rematches within a tournament while fresh opponents remain', () => {
    const first = r.result.games.filter((g) => g.game.stageId === 's00');
    const keys = first.flatMap((g) => g.matchups.map((m) => [m.home.membershipId, m.away!.membershipId].sort().join('|')));
    expect(new Set(keys).size).toBe(keys.length); // 5 games × 3 = 15 = every pair of 6 exactly once
  });

  it('honest managers weigh tiredness: they play tired far less than a repeater', () => {
    const t = simulateYear({ ...cfg, repeater: 0 });
    const tiredShare = (x: ReturnType<typeof simulateYear>) => {
      const mine = sidesOf(x).filter((sd) => sd.membershipId === 'm00');
      return mine.filter((sd) => sd.tired! < 1).length / mine.length;
    };
    expect(tiredShare(t)).toBeGreaterThan(tiredShare(r) + 0.3);
  });

  it('is deterministic per seed; a tanker changes only their own last-game pick in tournament 1', () => {
    expect(simulateYear(cfg)).toEqual(r);
    const t = simulateYear({ ...cfg, tanker: 0 });
    expect(t.input.statLines).toEqual(r.input.statLines);
    const stage1 = t.input.picks.filter((p, i) => p.stageId === 's00' && p.athleteId !== r.input.picks[i].athleteId);
    expect(stage1).toEqual([expect.objectContaining({ membershipId: 'm00', number: 5 })]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/core/simulate.test.ts`
Expected: FAIL — `result.games` is undefined (the old simulator returns weeks).

- [ ] **Step 3: Implement** — copy `src/core/simulate.ts` and `scripts/tune.ts` from `$S`.

```ts
import { allocate, fillLeftovers, type Bid, type ManagerBudget } from './allocation';
import { stageAllowance } from './points';
import { hashSeed, mulberry32 } from './rng';
import { parseSettings, type SeasonSettings } from './settings';
import { nextPairings, scoreTournaments, type TournamentInput, type TournamentResult } from './tournament';
import type { YearStatLine } from './year';

export interface YearSimConfig {
  managers: number;
  athletes: number;
  /** Tournaments in the year; each is one stage with a fresh auction. */
  stages: number;
  gamesPerStage: number;
  seed: string;
  settings?: unknown;
  /** This manager (index) throws the last game of every tournament by starting their worst active athlete. */
  tanker?: number;
  /** This manager (index) ignores tiredness and always starts their best active athlete. */
  repeater?: number;
}

export interface YearSimResult {
  settings: SeasonSettings;
  managerIds: string[];
  /** How far off each manager's read of athlete skill is (lower = sharper). */
  readNoise: Record<string, number>;
  /** Each manager's place (1 = best) at the end of each tournament; the last entry is the final standings. */
  placesByStage: Record<string, number>[];
  input: TournamentInput;
  result: TournamentResult;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const pad = (i: number) => String(i).padStart(2, '0');
const iso = (t: number) => new Date(t).toISOString();
const places = (r: TournamentResult) => Object.fromEntries(r.standings.map((x) => [x.membershipId, x.place]));

/**
 * A whole league year played by fake managers under the real rules, scored by the real scoreTournaments. Each
 * tournament: allowance from the standings so far → one sealed auction (allocate + fill) → each manager benches
 * the athlete they rate worst → games two hours apart, Swiss-paired by `nextPairings`; every manager starts the
 * active athlete with the best read × tiredness. Credits carry over. Tournaments are two weeks apart from 2027-01-09.
 * ponytail: no injuries, swaps, late joiners or missed picks; the DB dry run covers those.
 */
export function simulateYear(cfg: YearSimConfig): YearSimResult {
  const s = parseSettings(cfg.settings ?? {});
  const stream = (name: string) => mulberry32(hashSeed(`${cfg.seed}:${name}`));
  const setup = stream('setup');
  const managerIds = Array.from({ length: cfg.managers }, (_, i) => `m${pad(i)}`);
  const athleteIds = Array.from({ length: cfg.athletes }, (_, i) => `a${pad(i)}`);
  const skill = Object.fromEntries(athleteIds.map((a) => [a, 0.5 + setup()]));
  const readNoise = Object.fromEntries(managerIds.map((m) => [m, 0.05 + 0.6 * setup()]));
  const start = Date.parse('2027-01-09T14:00:00Z'); // a Saturday

  const input: TournamentInput = {
    settings: s, now: 0, games: [], pairings: [], slots: [], picks: [], swaps: [], sessions: [], statLines: [],
    injuries: [], currentStageId: null, members: managerIds.map((id) => ({ id, createdAt: iso(start - 30 * DAY) })),
  };
  const balance = Object.fromEntries(managerIds.map((m) => [m, 0]));
  const placesByStage: Record<string, number>[] = [];

  for (let st = 0; st < cfg.stages; st++) {
    const stageId = `s${pad(st)}`;
    const day1 = start + st * 14 * DAY;

    // Allowance from the standings so far (everyone ties before the first game), granted once the last
    // tournament's stats have locked, as the admin does.
    const sofar = scoreTournaments({ ...input, now: day1 - 5 * DAY });
    for (const row of sofar.standings) balance[row.membershipId] += stageAllowance(row.rank, cfg.managers, s);

    // Sealed auction: each manager bids on the players they rate best, more on the ones they rate higher.
    const read = stream(`read:${st}`);
    const perceived = Object.fromEntries(managerIds.map((m) => [m, Object.fromEntries(athleteIds.map((a) =>
      [a, skill[a] * (1 + readNoise[m] * (read() * 2 - 1))]))]));
    const bids: Bid[] = [];
    for (const m of managerIds) {
      const ranked = [...athleteIds].sort((a, b) => perceived[m][b] - perceived[m][a]);
      const top = ranked.slice(0, s.roster_size).reduce((sum, a) => sum + perceived[m][a], 0);
      ranked.slice(0, s.roster_size * 2).forEach((a, i) => bids.push({
        id: `${stageId}:${m}:${a}`, managerId: m, athleteId: a,
        amount: Math.max(s.min_bid, Math.floor((balance[m] * 0.9 * perceived[m][a]) / top)),
        placedAt: iso(day1 - 4 * DAY + i * 1000 + Math.floor(read() * 999)),
      }));
    }
    const budgets: ManagerBudget[] = managerIds.map((m) => ({ managerId: m, budget: balance[m], openSlots: s.roster_size }));
    const run = allocate(bids, budgets, athleteIds);
    const won = [...run.awards, ...fillLeftovers(run.remaining, run.unclaimed, `${cfg.seed}:${stageId}`)];
    for (const m of managerIds) {
      const mine = won.filter((aw) => aw.managerId === m);
      const benchCount = Math.min(s.bench_size, Math.max(0, mine.length - 1));
      const worst = [...mine].sort((a, b) => perceived[m][a.athleteId] - perceived[m][b.athleteId]).slice(0, benchCount)
        .map((aw) => aw.athleteId);
      for (const aw of mine) {
        balance[m] -= aw.amount;
        input.slots.push({ stageId, membershipId: m, athleteId: aw.athleteId, price: aw.amount, bench: worst.includes(aw.athleteId) });
      }
    }

    // Games: pair, pick (best read × tiredness; the tanker starts their worst in the last game), play, verify.
    const stats = stream(`stats:${st}`);
    for (let n = 1; n <= cfg.gamesPerStage; n++) {
      const startsAt = day1 + (n - 1) * 2 * HOUR;
      const id = `${stageId}g${pad(n)}`;
      for (const [home, away] of nextPairings({ ...input, now: startsAt - HOUR })) {
        input.pairings.push({ gameId: id, home, away });
      }
      const nextGame = scoreTournaments({ ...input, now: startsAt - HOUR, currentStageId: stageId }).next!;
      for (const side of nextGame.sides) {
        const m = side.membershipId;
        if (side.active.length === 0) continue;
        const value = (a: string) => perceived[m][a] * (managerIds.indexOf(m) === cfg.repeater ? 1 : side.rest[a]);
        const byValue = [...side.active].sort((a, b) => value(b) - value(a));
        const choice = n === cfg.gamesPerStage && managerIds.indexOf(m) === cfg.tanker ? byValue.at(-1)! : byValue[0];
        input.picks.push({ stageId, number: n, membershipId: m, athleteId: choice });
      }
      const sessionId = `${id}:s`;
      input.games.push({ id, stageId, number: n, sessionId, startedAt: iso(startsAt), finishedAt: iso(startsAt + HOUR) });
      input.sessions.push({ id: sessionId, verifiedAt: iso(startsAt + HOUR) });
      for (const a of athleteIds) input.statLines.push(statLine(sessionId, a, skill[a], stats));
    }
    input.now = day1 + 5 * DAY; // every game verified and locked
    placesByStage.push(places(scoreTournaments(input)));
  }

  return { settings: s, managerIds, readNoise, placesByStage, input, result: scoreTournaments(input) };
}

/** One athlete's line for one game: better players (k) score more and turn it over less. */
function statLine(sessionId: string, athleteId: string, k: number, rand: () => number): YearStatLine {
  return {
    sessionId,
    athleteId,
    pointsPlayed: 5 + Math.floor(rand() * 15),
    stats: {
      goal: Math.floor(rand() * 3 * k),
      assist: Math.floor(rand() * 3 * k),
      block: Math.floor(rand() * 2 * k),
      callahan: rand() < 0.02 * k ? 1 : 0,
      turnover: Math.floor(rand() * 3 * (1.5 - k / 1.5)),
    },
  };
}
```

```ts
// Sweeps upset_k × tiredness over simulated tournament years (board t64, tournament mode §5). Usage:
//   npm run tune -- [seeds=200] [managers=6] [roster=4] [games=6]
// Per combo: how often the manager with the sharpest read wins the year, how much places churn between tournaments,
// whether throwing each tournament's last game pays (tank Δ = mean final place tanking − honest; > 0 = it hurts),
// and whether ignoring tiredness pays (repeat Δ, same sign: > 0 = always starting your best hurts).
import { simulateYear } from '../src/core/simulate';

const [seeds = 200, managers = 6, roster = 4, games = 6] = process.argv.slice(2).map(Number);
const UPSET_K = [0, 0.5, 1];
const TIREDNESS = [[0.5, 0.75], [0.4, 0.6], [0.3], [0.5], []];

const rows = [];
for (const upset_k of UPSET_K) {
  for (const tiredness_multipliers of TIREDNESS) {
    const settings = { upset_k, tiredness_multipliers, roster_size: roster, max_members: managers };
    let sharpWins = 0, churn = 0, tankDelta = 0, tankPays = 0, repeatDelta = 0, repeatPays = 0;
    for (let i = 0; i < seeds; i++) {
      const base = { managers, athletes: managers * roster, stages: 3, gamesPerStage: games, seed: `tune${i}`, settings };
      const honest = simulateYear(base);
      const sharp = honest.managerIds.reduce((a, b) => (honest.readNoise[a] <= honest.readNoise[b] ? a : b));
      const final = honest.placesByStage.at(-1)!;
      if (final[sharp] === 1) sharpWins++;
      for (let st = 1; st < honest.placesByStage.length; st++) {
        for (const m of honest.managerIds) churn += Math.abs(honest.placesByStage[st][m] - honest.placesByStage[st - 1][m]);
      }
      const who = i % managers;
      const id = honest.managerIds[who];
      const tank = simulateYear({ ...base, tanker: who }).placesByStage.at(-1)![id] - final[id];
      tankDelta += tank;
      if (tank < 0) tankPays++;
      const repeat = simulateYear({ ...base, repeater: who }).placesByStage.at(-1)![id] - final[id];
      repeatDelta += repeat;
      if (repeat < 0) repeatPays++;
    }
    rows.push({
      upset_k, tiredness: JSON.stringify(tiredness_multipliers),
      'sharp wins %': +((100 * sharpWins) / seeds).toFixed(1),
      churn: +(churn / (seeds * managers * 2)).toFixed(2),
      'tank Δ': +(tankDelta / seeds).toFixed(2),
      'tank pays %': +((100 * tankPays) / seeds).toFixed(1),
      'repeat Δ': +(repeatDelta / seeds).toFixed(2),
      'repeat pays %': +((100 * repeatPays) / seeds).toFixed(1),
    });
  }
}
console.log(`${seeds} seeds, ${managers} teams × ${roster}, 3 tournaments × ${games} games. ` +
  `Random chance of winning: ${(100 / managers).toFixed(1)}%.`);
console.table(rows);
```

- [ ] **Step 4: Run the tests, checks and a short sweep**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run src/core && npx tsc -b && npx eslint . && npm run tune -- 10`
Expected: all core tests pass; the sweep prints a 15-row table (3 `upset_k` × 5 tiredness lists) with
`repeat Δ` 0 on the `[]` rows. (The full 100-seed numbers are in spec amendment 12; that sweep takes ~2 min.)

- [ ] **Step 5: Commit**

```bash
git add src/core/simulate.ts src/core/simulate.test.ts scripts/tune.ts
git commit -m "feat(core): simulator and tune sweep play tournament years (tournament mode T1)"
```

---

### Task 3: Database — games, pairings, picks, bench (`0012_tournament.sql`)

**Model:** sonnet to copy and run; the reviewer is **opus** (security: RLS, sealed picks, role checks, pairing
shape check).

**Files:**
- Create: `supabase/migrations/0012_tournament.sql`, `tests/db/rpc-tournament.test.ts`
- Modify: `tests/db/rpc-gate.test.ts` (new RPCs in the role lists + audit steps), `src/app/lib/backup.ts`
  (the four new tables, required by `backup.test.ts`'s every-table check)

**Interfaces:**
- Consumes: `private.require_admin/require_keeper/require_user`, `private.audit`, `private.setting_num` (existing).
- Produces (T3 calls these exactly):

| RPC | Who | Errors |
|---|---|---|
| `open_tournament(p_stage uuid, p_pairings jsonb) → uuid` (game 1 id) | admin | `NOT_FOUND`, `GAMES_EXIST`, `PAIRINGS_INVALID` |
| `start_game(p_game uuid) → uuid` (session id) | keeper/admin | `NOT_FOUND`, `GAME_STARTED`, `PREVIOUS_GAME_LIVE` |
| `finish_game(p_game uuid, p_pairings jsonb, p_provisional jsonb) → uuid` (next game id) | keeper/admin | `NOT_FOUND`, `GAME_NOT_LIVE`, `PAIRINGS_INVALID` |
| `set_game_pick(p_membership uuid, p_stage uuid, p_number int, p_athlete uuid or null)` | own membership | `NOT_FOUND`, `NOT_MEMBER`, `PICK_LOCKED`, `NOT_NEXT_GAME`, `NOT_ON_ROSTER` |
| `set_bench(p_membership uuid, p_stage uuid, p_athletes uuid[])` | own membership | `NOT_FOUND`, `NOT_MEMBER`, `TOURNAMENT_STARTED`, `NOT_ON_ROSTER`, `BENCH_SIZE` |
| `swap_bench(p_membership uuid, p_stage uuid, p_out uuid, p_in uuid)` | own membership | `NOT_FOUND`, `NOT_MEMBER`, `TOURNAMENT_NOT_STARTED`, `NOT_ACTIVE`, `NOT_ON_BENCH`, `NOT_INJURED`, `SWAP_USED` |

`p_pairings` = `[{league_id, home, away or null}]` covering every league of the stage's season.
Tables: `games(id, stage_id, number, session_id, started_at, finished_at, created_at)`,
`game_pairings(game_id, league_id, home, away)`, `game_picks(stage_id, game_number, membership_id, league_id,
athlete_id, updated_at)`, `bench_swaps(id, stage_id, membership_id, out_athlete, in_athlete, from_game,
created_at)`, `roster_slots.bench boolean`.

- [ ] **Step 1: Write the failing tests** — copy `tests/db/rpc-tournament.test.ts` from `$S^3` and
  `tests/db/rpc-gate.test.ts` from `$S`.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, injure, member, type AuctionFixture } from './auction-fixture';
import { makeKeeper } from './stats-fixture';

let f: AuctionFixture;
let keeper: string;
let alice: string, aliceM: string, bob: string, bobM: string, carol: string, carolM: string;

/** carol has the bye: three teams in league A. */
const pairings = () => [
  { league_id: f.league, home: aliceM, away: bobM },
  { league_id: f.league, home: carolM, away: null },
];
const open = (p: unknown = pairings(), who = f.admin) =>
  as(f.db, who, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: p })) as Promise<string>;
const start = (game: string, who = keeper) => as(f.db, who, (tx) => rpc(tx, 'start_game', { p_game: game })) as Promise<string>;
const finish = (game: string, p: unknown = pairings(), who = keeper) =>
  as(f.db, who, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: p, p_provisional: { standings: 'x' } })) as Promise<string>;
const setPick = (uid: string, mid: string, number: number, athlete: string | null) =>
  as(f.db, uid, (tx) => rpc(tx, 'set_game_pick', { p_membership: mid, p_stage: f.stage, p_number: number, p_athlete: athlete }));
const setBench = (uid: string, mid: string, athletes: string[]) =>
  // A Postgres array literal: the rpc helper sends arrays as JSON (PostgREST converts them itself).
  as(f.db, uid, (tx) => rpc(tx, 'set_bench', { p_membership: mid, p_stage: f.stage, p_athletes: `{${athletes.join(',')}}` }));
const swap = (uid: string, mid: string, out: string, inn: string) =>
  as(f.db, uid, (tx) => rpc(tx, 'swap_bench', { p_membership: mid, p_stage: f.stage, p_out: out, p_in: inn }));
const game = async (number: number) => (await f.db.query<{ id: string; session_id: string | null; started: boolean; finished: boolean }>(
  `select id, session_id, started_at is not null as started, finished_at is not null as finished
   from public.games where stage_id = $1 and number = $2`, [f.stage, number])).rows[0];
const benchOf = async (mid: string) => (await f.db.query<{ athlete_id: string }>(
  `select athlete_id from public.roster_slots where membership_id = $1 and bench order by athlete_id`, [mid])).rows.map((r) => r.athlete_id);
const audit = async (action: string) => (await f.db.query<{ details: Record<string, unknown> }>(
  'select details from public.audit_log where action = $1', [action])).rows;

beforeEach(async () => {
  f = await auctionFixture(12);
  keeper = await createUser(f.db, 'keeper@x.test');
  await makeKeeper(f.db, keeper);
  [alice, aliceM] = await member(f.db, 'alice');
  [bob, bobM] = await member(f.db, 'bob');
  [carol, carolM] = await member(f.db, 'carol');
  // Rosters straight in (the auction is tested elsewhere): alice A0–A3 (A3 cheapest), bob A4–A7 (A4 cheapest),
  // carol A8 alone (no bench).
  const rows: [string, number, number][] = [[aliceM, 0, 30], [aliceM, 1, 20], [aliceM, 2, 10], [aliceM, 3, 5],
    [bobM, 4, 1], [bobM, 5, 9], [bobM, 6, 9], [bobM, 7, 9], [carolM, 8, 50]];
  for (const [mid, a, price] of rows) {
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, $5, 'bid')`, [f.stage, mid, f.league, f.athletes[a], price]);
  }
});

describe('open_tournament', () => {
  it('creates game 1 with its pairings, once, and audits them', async () => {
    const id = await open();
    expect(await game(1)).toMatchObject({ id, session_id: null, started: false });
    const rows = await f.db.query('select home, away from public.game_pairings where game_id = $1 order by home', [id]);
    expect(rows.rows).toHaveLength(2);
    expect((await audit('open_tournament'))[0].details).toMatchObject({ game_id: id });
    await expect(open()).rejects.toThrow('GAMES_EXIST');
  });

  it('refuses pairings that miss, repeat or misplace a team, or give a league two byes', async () => {
    const other = (await as(f.db, f.admin, (tx) => rpc(tx, 'create_league', { p_season: f.season, p_name: 'League B' }))) as string;
    const bad = [
      null, {}, [1], [{ league_id: f.league, home: aliceM, away: bobM }],
      [...pairings(), { league_id: f.league, home: aliceM, away: null }],
      [{ league_id: f.league, home: aliceM, away: null }, { league_id: f.league, home: bobM, away: null },
        { league_id: f.league, home: carolM, away: null }],
      [{ league_id: other, home: aliceM, away: bobM }, { league_id: f.league, home: carolM, away: null }],
      [{ league_id: f.league, home: aliceM, away: aliceM }, { league_id: f.league, home: bobM, away: carolM }],
      [{ league_id: f.league, home: 'not-a-uuid', away: bobM }, { league_id: f.league, home: carolM, away: null }],
      [{ league_id: f.league, away: bobM }, { league_id: f.league, home: carolM, away: aliceM }],
    ];
    for (const p of bad) await expect(open(p), JSON.stringify(p)).rejects.toThrow('PAIRINGS_INVALID');
    expect(await game(1)).toBeUndefined();
  });

  it('is admin-only and needs a real stage', async () => {
    await expect(open(pairings(), keeper)).rejects.toThrow('FORBIDDEN');
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: crypto.randomUUID(), p_pairings: [] })))
      .rejects.toThrow('NOT_FOUND');
  });
});

describe('start_game / finish_game', () => {
  it('starts a game: a counted tournament session, linked, once', async () => {
    const g1 = await open();
    const sid = await start(g1);
    expect(await game(1)).toMatchObject({ session_id: sid, started: true, finished: false });
    const s = await f.db.query<{ kind: string; counts: boolean; created_by: string }>('select kind, counts, created_by from public.sessions where id = $1', [sid]);
    expect(s.rows[0]).toEqual({ kind: 'tournament', counts: true, created_by: keeper });
    await expect(start(g1)).rejects.toThrow('GAME_STARTED');
    await expect(start(g1, alice)).rejects.toThrow('FORBIDDEN');
  });

  it('fixes the default bench when game 1 starts, keeping a valid choice', async () => {
    const g1 = await open();
    await setBench(bob, bobM, [f.athletes[5]]);
    await start(g1);
    expect(await benchOf(aliceM)).toEqual([f.athletes[3]]); // cheapest
    expect(await benchOf(bobM)).toEqual([f.athletes[5]]); // chosen
    expect(await benchOf(carolM)).toEqual([]); // one athlete: no bench
  });

  it('finishes a live game into the next one with the given pairings, auditing the provisional inputs', async () => {
    const g1 = await open();
    await expect(finish(g1)).rejects.toThrow('GAME_NOT_LIVE');
    await start(g1);
    const next = [{ league_id: f.league, home: aliceM, away: carolM }, { league_id: f.league, home: bobM, away: null }];
    await expect(finish(g1, [{ league_id: f.league, home: aliceM, away: bobM }])).rejects.toThrow('PAIRINGS_INVALID');
    const g2 = await finish(g1, next);
    expect(await game(1)).toMatchObject({ finished: true });
    expect(await game(2)).toMatchObject({ id: g2, started: false });
    expect((await audit('finish_game'))[0].details).toMatchObject({ next_game_id: g2, provisional: { standings: 'x' } });
    await expect(finish(g1)).rejects.toThrow('GAME_NOT_LIVE');
    await expect(finish(g2, pairings(), alice)).rejects.toThrow('FORBIDDEN');
  });

  it('refuses to start a game while an earlier one is live', async () => {
    await open();
    await f.db.query(`insert into public.games (stage_id, number) values ($1, 2)`, [f.stage]);
    await start((await game(1)).id);
    await expect(start((await game(2)).id)).rejects.toThrow('PREVIOUS_GAME_LIVE');
  });

  it("leaves the game void (session_id null) when its session is deleted", async () => {
    const g1 = await open();
    const sid = await start(g1);
    await f.db.query('delete from public.sessions where id = $1', [sid]);
    expect(await game(1)).toMatchObject({ session_id: null, started: true });
  });
});

describe('set_game_pick', () => {
  it('pre-selects game 1 before the tournament opens, then locks it at the start', async () => {
    await setPick(alice, aliceM, 1, f.athletes[0]);
    await setPick(alice, aliceM, 1, f.athletes[1]);
    const g1 = await open();
    await start(g1);
    await expect(setPick(alice, aliceM, 1, f.athletes[2])).rejects.toThrow('PICK_LOCKED');
    const picks = await f.db.query<{ athlete_id: string }>('select athlete_id from public.game_picks where game_number = 1');
    expect(picks.rows).toEqual([{ athlete_id: f.athletes[1] }]);
  });

  it('takes the next game only, even before that game exists', async () => {
    await expect(setPick(alice, aliceM, 2, f.athletes[0])).rejects.toThrow('NOT_NEXT_GAME');
    await start(await open());
    await setPick(alice, aliceM, 2, f.athletes[0]); // game 1 live, game 2 not created yet
    await expect(setPick(alice, aliceM, 3, f.athletes[0])).rejects.toThrow('NOT_NEXT_GAME');
    await expect(setPick(alice, aliceM, 0, f.athletes[0])).rejects.toThrow('PICK_LOCKED');
  });

  it('checks the roster and the membership, and null clears', async () => {
    await expect(setPick(alice, aliceM, 1, f.athletes[4])).rejects.toThrow('NOT_ON_ROSTER');
    await expect(setPick(bob, aliceM, 1, f.athletes[0])).rejects.toThrow('NOT_MEMBER');
    await setPick(alice, aliceM, 1, f.athletes[3]); // the bench is allowed: the scorer replaces it
    await setPick(alice, aliceM, 1, null);
    expect((await f.db.query('select 1 from public.game_picks')).rows).toEqual([]);
  });

  it('stays sealed from the league until its game starts', async () => {
    const visible = (uid: string) => as(f.db, uid, async (tx) =>
      (await tx.query<{ membership_id: string }>('select membership_id from public.game_picks')).rows.map((r) => r.membership_id));
    await setPick(alice, aliceM, 1, f.athletes[0]);
    expect(await visible(alice)).toEqual([aliceM]);
    expect(await visible(bob)).toEqual([]);
    expect(await visible(keeper)).toEqual([]);
    await start(await open());
    expect(await visible(bob)).toEqual([aliceM]);
    expect(await visible(keeper)).toEqual([aliceM]);
    const stranger = await createUser(f.db, 'stranger@x.test');
    expect(await visible(stranger)).toEqual([]);
  });
});

describe('set_bench', () => {
  it('sets exactly the bench count of the roster', async () => {
    await setBench(alice, aliceM, [f.athletes[0]]);
    expect(await benchOf(aliceM)).toEqual([f.athletes[0]]);
    await setBench(alice, aliceM, [f.athletes[2]]);
    expect(await benchOf(aliceM)).toEqual([f.athletes[2]]);
    await expect(setBench(alice, aliceM, [])).rejects.toThrow('BENCH_SIZE');
    await expect(setBench(alice, aliceM, [f.athletes[0], f.athletes[1]])).rejects.toThrow('BENCH_SIZE');
    await expect(setBench(alice, aliceM, [f.athletes[0], f.athletes[0]])).rejects.toThrow('BENCH_SIZE');
    await expect(setBench(alice, aliceM, [f.athletes[4]])).rejects.toThrow('NOT_ON_ROSTER');
    await expect(setBench(bob, aliceM, [f.athletes[0]])).rejects.toThrow('NOT_MEMBER');
    await setBench(carol, carolM, []); // a one-athlete roster has no bench
  });

  it('refuses once the tournament has started', async () => {
    await start(await open());
    await expect(setBench(alice, aliceM, [f.athletes[0]])).rejects.toThrow('TOURNAMENT_STARTED');
  });
});

describe('swap_bench', () => {
  it('swaps the bench in for an injured active athlete from the next game, once per stage', async () => {
    await expect(swap(alice, aliceM, f.athletes[0], f.athletes[3])).rejects.toThrow('TOURNAMENT_NOT_STARTED');
    const g1 = await open();
    await start(g1); // alice's bench: A3 (default)
    await expect(swap(alice, aliceM, f.athletes[0], f.athletes[3])).rejects.toThrow('NOT_INJURED');
    await injure(f, f.athletes[0]);
    await expect(swap(alice, aliceM, f.athletes[3], f.athletes[0])).rejects.toThrow('NOT_ACTIVE');
    await expect(swap(alice, aliceM, f.athletes[0], f.athletes[1])).rejects.toThrow('NOT_ON_BENCH');
    await expect(swap(bob, aliceM, f.athletes[0], f.athletes[3])).rejects.toThrow('NOT_MEMBER');
    await swap(alice, aliceM, f.athletes[0], f.athletes[3]);
    const rows = await f.db.query('select out_athlete, in_athlete, from_game from public.bench_swaps');
    expect(rows.rows).toEqual([{ out_athlete: f.athletes[0], in_athlete: f.athletes[3], from_game: 2 }]);
    await injure(f, f.athletes[1]);
    await expect(swap(alice, aliceM, f.athletes[1], f.athletes[3])).rejects.toThrow('SWAP_USED');
  });
});

describe('deletes', () => {
  it('drops a deleted athlete\'s picks and swaps (cascade)', async () => {
    await setPick(alice, aliceM, 1, f.athletes[0]);
    await f.db.query('delete from public.athletes where id = $1', [f.athletes[0]]);
    expect((await f.db.query('select 1 from public.game_picks')).rows).toEqual([]);
  });
});
```

`tests/db/rpc-gate.test.ts` and `src/app/lib/backup.ts`:

```diff
diff --git a/src/app/lib/backup.ts b/src/app/lib/backup.ts
index a261887..72183fd 100644
--- a/src/app/lib/backup.ts
+++ b/src/app/lib/backup.ts
@@ -8,7 +8,8 @@ export const BACKUP_TABLES: Record<string, string[]> = {
   memberships: ['id'], athletes: ['id'], audit_log: ['id'], sessions: ['id'], stat_taps: ['id'],
   stat_lines: ['session_id', 'athlete_id'], attendance: ['session_id', 'athlete_id'], injuries: ['id'],
   stages: ['id'], credit_ledger: ['id'], bids: ['id'], roster_slots: ['id'], weeks: ['id'],
-  picks: ['week_id', 'membership_id'],
+  picks: ['week_id', 'membership_id'], games: ['id'], game_pairings: ['game_id', 'home'],
+  game_picks: ['stage_id', 'game_number', 'membership_id'], bench_swaps: ['id'],
 };
 
 export interface Backup { exportedAt: string; tables: Record<string, unknown[]> }
diff --git a/tests/db/rpc-gate.test.ts b/tests/db/rpc-gate.test.ts
index 8c42697..d36af86 100644
--- a/tests/db/rpc-gate.test.ts
+++ b/tests/db/rpc-gate.test.ts
@@ -10,10 +10,13 @@ const READ_HELPERS = ['can_read_league_data', 'has_role', 'is_admin', 'is_keeper
 /** Any signed-in user may call these; they check ownership instead of a role. */
 const MEMBER_CALLABLE = [
   'clear_injury', 'delete_bid', 'join_league', 'place_bid', 'report_injury', 'set_attendance', 'set_display_name',
-  'set_pick',
+  'set_bench', 'set_game_pick', 'set_pick', 'swap_bench',
 ];
 /** Keepers (and admins) may call these; every other staff RPC is admin-only. */
-const KEEPER_CALLABLE = ['confirm_injury', 'create_session', 'delete_session', 'reopen_session', 'save_taps', 'verify_session'];
+const KEEPER_CALLABLE = [
+  'confirm_injury', 'create_session', 'delete_session', 'finish_game', 'reopen_session', 'save_taps', 'start_game',
+  'verify_session',
+];
 
 let db: PGlite;
 let fns: { name: string; nargs: number }[];
@@ -94,6 +97,15 @@ describe('RPC gate', () => {
       ['rename_athlete', admin, () => ({ p_athlete: c.athlete, p_name: 'Patricia' })],
       ['delete_athlete', admin, () => ({ p_athlete: c.spare })],
       ['delete_session', keeper, () => ({ p_session: c.empty })],
+      ['set_game_pick', player, () => ({ p_membership: c.membership, p_stage: c.stage, p_number: 1, p_athlete: null })],
+      // roster_size 1 here, so the bench is empty (Postgres array literal: the rpc helper sends arrays as JSON).
+      ['set_bench', player, () => ({ p_membership: c.membership, p_stage: c.stage, p_athletes: '{}' })],
+      ['open_tournament', admin, () => ({ p_stage: c.stage, p_pairings: [{ league_id: c.league, home: c.membership, away: null }] }),
+        (r) => (c.game = r as string)],
+      ['start_game', keeper, () => ({ p_game: c.game })],
+      ['swap_bench', player, () => ({ p_membership: c.membership, p_stage: c.stage, p_out: c.hurt, p_in: c.sub })],
+      ['finish_game', keeper, () => ({ p_game: c.game, p_pairings: [{ league_id: c.league, home: c.membership, away: null }],
+        p_provisional: {} })],
     ];
 
     const covered = new Set(steps.map(([name]) => name));
@@ -121,6 +133,15 @@ describe('RPC gate', () => {
         c.empty = (await as(db, keeper, (tx) =>
           rpc(tx, 'create_session', { p_season: c.season, p_kind: 'practice', p_held_on: '2026-11-17', p_counts: true }))) as string;
       }
+      if (name === 'swap_bench') {
+        // Superuser writes: an injured active athlete and a bench athlete on the gate membership's roster.
+        for (const [key, bench] of [['hurt', false], ['sub', true]] as const) {
+          c[key] = (await as(db, admin, (tx) => rpc(tx, 'add_athlete', { p_season: c.season, p_name: key, p_user: null }))) as string;
+          await db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via, bench)
+            values ($1, $2, $3, $4, 0, 'fill', $5)`, [c.stage, c.membership, c.league, c[key], bench]);
+        }
+        await db.query('insert into public.injuries (athlete_id, confirmed_at) values ($1, now())', [c.hurt]);
+      }
       if (name === 'run_auction') {
         await db.query(`update public.stages set bid_close_at = now() - interval '1 second' where id = $1`, [c.stage]);
       }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run tests/db/rpc-tournament.test.ts tests/db/rpc-gate.test.ts`
Expected: FAIL — `function public.open_tournament(...) does not exist`; the gate's audit steps name RPCs that
don't exist.

- [ ] **Step 3: Implement** — copy `supabase/migrations/0012_tournament.sql` from `$S^3` and
  `src/app/lib/backup.ts` from `$S`.

```sql
-- Tournament mode: one-on-one game matchups. Spec: docs/superpowers/specs/2026-10-02-tournament-mode-design.md
-- Additive: the weekly tables and RPCs stay until the weekly UI is retired (spec §8 T4). Scoring and Swiss pairing run
-- in the browser (src/core/tournament.ts); the database holds games, frozen pairings, sealed picks and bench state.

-- Games of a stage, created one at a time: game 1 by open_tournament, game N+1 by finish_game(N).
create table public.games (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages (id) on delete cascade,
  number int not null check (number >= 1),
  -- A deleted session leaves the game void (amendment 4).
  session_id uuid unique references public.sessions (id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (stage_id, number),
  check (finished_at is null or started_at is not null)
);

-- Frozen when the game is created. away null = bye.
create table public.game_pairings (
  game_id uuid not null references public.games (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  home uuid not null references public.memberships (id) on delete cascade,
  away uuid references public.memberships (id) on delete cascade,
  unique (game_id, home),
  unique (game_id, away)
);

-- Keyed by game number with no FK to games, so the next game's pick can be set before the game exists. Sealed until
-- that game starts; league_id copied so RLS needn't join (as picks/bids).
create table public.game_picks (
  stage_id uuid not null references public.stages (id) on delete cascade,
  game_number int not null check (game_number >= 1),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  athlete_id uuid not null references public.athletes (id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (stage_id, game_number, membership_id)
);
create index game_picks_league_idx on public.game_picks (league_id);

-- The manager's bench choice. Unset (or the wrong count) means the default: the cheapest (src/core/tournament.ts
-- lineup); start_game fixes the default into these flags when game 1 starts.
alter table public.roster_slots add column bench boolean not null default false;

-- One injury swap per manager per stage: in_athlete (bench) plays instead of out_athlete from game from_game on.
create table public.bench_swaps (
  id uuid primary key default gen_random_uuid(),
  stage_id uuid not null references public.stages (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  out_athlete uuid not null references public.athletes (id) on delete cascade,
  in_athlete uuid not null references public.athletes (id) on delete cascade,
  from_game int not null check (from_game >= 1),
  created_at timestamptz not null default now(),
  unique (stage_id, membership_id)
);

alter table public.games enable row level security;
alter table public.game_pairings enable row level security;
alter table public.game_picks enable row level security;
alter table public.bench_swaps enable row level security;
grant select on public.games, public.game_pairings, public.game_picks, public.bench_swaps to authenticated;
create policy games_read on public.games for select to authenticated using (true);
create policy game_pairings_read on public.game_pairings for select to authenticated using (true);
create policy bench_swaps_read on public.bench_swaps for select to authenticated using (true);
create policy game_picks_read on public.game_picks for select to authenticated using (
  membership_id in (select id from public.memberships where user_id = auth.uid())
  or (exists (select 1 from public.games g where g.stage_id = game_picks.stage_id and g.number = game_picks.game_number
              and g.started_at is not null)
      and (league_id in (select league_id from public.memberships where user_id = auth.uid())
           or exists (select 1 from public.user_roles where user_id = auth.uid()))));

-- The next game a pick can be set for: one past the stage's highest started game.
create function private.next_game(p_stage uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(max(number), 0) + 1 from public.games where stage_id = p_stage and started_at is not null
$$;

-- Bench size for a roster of p_roster athletes: bench_size, but always leaving one active athlete (amendment 1).
create function private.bench_count(p_stage uuid, p_roster int) returns int
language sql stable security definer set search_path = '' as $$
  select least(private.setting_num(st.season_id, 'bench_size', 1)::int, greatest(0, p_roster - 1))
  from public.stages st where st.id = p_stage
$$;

-- PAIRINGS_INVALID unless p_pairings ([{league_id, home, away|null}]) has every membership of every league of the
-- stage's season that joined by now exactly once, in its own league, with at most one bye per league.
create function private.check_pairings(p_stage uuid, p_pairings jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare season uuid; bad boolean;
begin
  select season_id into season from public.stages where id = p_stage;
  if p_pairings is null or jsonb_typeof(p_pairings) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_pairings) e where jsonb_typeof(e) <> 'object') then
    raise exception 'PAIRINGS_INVALID';
  end if;
  begin
    with p as (
      select (e ->> 'league_id')::uuid as league_id, (e ->> 'home')::uuid as home, (e ->> 'away')::uuid as away
      from jsonb_array_elements(p_pairings) e
    ), ids as (
      select league_id, home as id from p union all select league_id, away from p where away is not null
    ), expected as (
      select m.id, m.league_id from public.memberships m join public.leagues l on l.id = m.league_id
      where l.season_id = season and m.created_at <= now()
    )
    select exists (select 1 from ids left join expected x on x.id = ids.id and x.league_id = ids.league_id where x.id is null)
        or exists (select id from ids group by id having count(*) > 1)
        or exists (select 1 from expected x where not exists (select 1 from ids where ids.id = x.id))
        or exists (select 1 from p where away is null group by league_id having count(*) > 1)
      into bad;
  exception when invalid_text_representation then
    raise exception 'PAIRINGS_INVALID';
  end;
  if bad then raise exception 'PAIRINGS_INVALID'; end if;
end $$;

create function private.insert_pairings(p_game uuid, p_pairings jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.game_pairings (game_id, league_id, home, away)
  select p_game, (e ->> 'league_id')::uuid, (e ->> 'home')::uuid, (e ->> 'away')::uuid
  from jsonb_array_elements(p_pairings) e
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- Admin, after the stage's auction: creates game 1 with pairings the admin's browser computed (nextPairings).
create function public.open_tournament(p_stage uuid, p_pairings jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid;
begin
  perform private.require_admin();
  perform 1 from public.stages where id = p_stage for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if exists (select 1 from public.games where stage_id = p_stage) then raise exception 'GAMES_EXIST'; end if;
  perform private.check_pairings(p_stage, p_pairings);
  insert into public.games (stage_id, number) values (p_stage, 1) returning id into gid;
  perform private.insert_pairings(gid, p_pairings);
  perform private.audit('open_tournament', 'stage', p_stage::text, jsonb_build_object('game_id', gid, 'pairings', p_pairings));
  return gid;
end $$;

-- Keeper taps Start: picks lock and a counted tournament session is created for the tally. Game 1 also fixes each
-- roster's bench: a manager who didn't choose the right count gets the default (cheapest, then lowest id).
create function public.start_game(p_game uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_keeper(); g public.games; season uuid; sid uuid;
begin
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.started_at is not null then raise exception 'GAME_STARTED'; end if;
  if exists (select 1 from public.games where stage_id = g.stage_id and number < g.number and finished_at is null) then
    raise exception 'PREVIOUS_GAME_LIVE';
  end if;
  select season_id into season from public.stages where id = g.stage_id;
  insert into public.sessions (season_id, kind, held_on, counts, created_by)
  values (season, 'tournament', (now() at time zone 'America/New_York')::date, true, uid) returning id into sid;
  update public.games set session_id = sid, started_at = now() where id = p_game;
  if g.number = 1 then
    with r as (
      select rs.id, rs.membership_id, rs.bench,
        row_number() over (partition by rs.membership_id order by rs.price, rs.athlete_id) as cheap,
        count(*) over (partition by rs.membership_id) as size,
        count(*) filter (where rs.bench) over (partition by rs.membership_id) as flagged
      from public.roster_slots rs where rs.stage_id = g.stage_id
    )
    update public.roster_slots rs set bench = (r.cheap <= private.bench_count(g.stage_id, r.size::int))
    from r where rs.id = r.id and r.flagged <> private.bench_count(g.stage_id, r.size::int);
  end if;
  perform private.audit('start_game', 'game', p_game::text, jsonb_build_object('session_id', sid, 'number', g.number));
  return sid;
end $$;

-- Keeper taps Finish: the keeper's browser sends the Swiss pairings for the next game, computed from provisional
-- standings (copied into the audit row with its inputs, so anyone can re-run it).
create function public.finish_game(p_game uuid, p_pairings jsonb, p_provisional jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare g public.games; gid uuid;
begin
  perform private.require_keeper();
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if g.started_at is null or g.finished_at is not null then raise exception 'GAME_NOT_LIVE'; end if;
  perform private.check_pairings(g.stage_id, p_pairings);
  update public.games set finished_at = now() where id = p_game;
  insert into public.games (stage_id, number) values (g.stage_id, g.number + 1) returning id into gid;
  perform private.insert_pairings(gid, p_pairings);
  perform private.audit('finish_game', 'game', p_game::text,
    jsonb_build_object('next_game_id', gid, 'pairings', p_pairings, 'provisional', p_provisional));
  return gid;
end $$;

-- The manager's pick for the next game only (amendment 2). Null clears it. Bench, tiredness and injuries are NOT
-- checked: src/core/tournament.ts replaces an invalid pick at the start, so those rules live in one place.
create function public.set_game_pick(p_membership uuid, p_stage uuid, p_number int, p_athlete uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); lid uuid; nxt int;
begin
  if not exists (select 1 from public.stages where id = p_stage) then raise exception 'NOT_FOUND'; end if;
  select league_id into lid from public.memberships where id = p_membership and user_id = uid;
  if not found then raise exception 'NOT_MEMBER'; end if;
  -- Waits for a concurrent start_game, so a pick can't slip in after its game starts.
  perform 1 from public.games where stage_id = p_stage for share;
  nxt := private.next_game(p_stage);
  if p_number is null or p_number < nxt then raise exception 'PICK_LOCKED'; end if;
  if p_number > nxt then raise exception 'NOT_NEXT_GAME'; end if;
  if p_athlete is null then
    delete from public.game_picks where stage_id = p_stage and game_number = p_number and membership_id = p_membership;
  else
    if not exists (select 1 from public.roster_slots
                   where stage_id = p_stage and membership_id = p_membership and athlete_id = p_athlete) then
      raise exception 'NOT_ON_ROSTER';
    end if;
    insert into public.game_picks (stage_id, game_number, membership_id, league_id, athlete_id)
    values (p_stage, p_number, p_membership, lid, p_athlete)
    on conflict (stage_id, game_number, membership_id) do update set athlete_id = excluded.athlete_id, updated_at = now();
  end if;
  -- No athlete here: admins read the audit log, and picks stay sealed until the game starts.
  perform private.audit('set_game_pick', 'stage', p_stage::text, jsonb_build_object('membership_id', p_membership, 'number', p_number));
end $$;

-- The manager's bench before game 1 starts: exactly the bench count of their roster.
create function public.set_bench(p_membership uuid, p_stage uuid, p_athletes uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); size int;
begin
  if not exists (select 1 from public.stages where id = p_stage) then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.memberships where id = p_membership and user_id = uid) then raise exception 'NOT_MEMBER'; end if;
  perform 1 from public.games where stage_id = p_stage for share;
  if exists (select 1 from public.games where stage_id = p_stage and started_at is not null) then
    raise exception 'TOURNAMENT_STARTED';
  end if;
  select count(*) into size from public.roster_slots where stage_id = p_stage and membership_id = p_membership;
  if exists (select 1 from unnest(coalesce(p_athletes, '{}')) a where not exists (
       select 1 from public.roster_slots where stage_id = p_stage and membership_id = p_membership and athlete_id = a)) then
    raise exception 'NOT_ON_ROSTER';
  end if;
  if (select count(distinct a) from unnest(coalesce(p_athletes, '{}')) a) <> private.bench_count(p_stage, size)
     or cardinality(coalesce(p_athletes, '{}')) <> private.bench_count(p_stage, size) then
    raise exception 'BENCH_SIZE';
  end if;
  update public.roster_slots set bench = (athlete_id = any (p_athletes))
  where stage_id = p_stage and membership_id = p_membership;
  perform private.audit('set_bench', 'stage', p_stage::text, jsonb_build_object('membership_id', p_membership, 'athletes', p_athletes));
end $$;

-- Once per stage, after game 1 has started: a bench athlete replaces an active athlete with a confirmed injury from
-- the next game that hasn't started. Flags stay as they are: the core applies the swap from from_game on.
create function public.swap_bench(p_membership uuid, p_stage uuid, p_out uuid, p_in uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid := private.require_user(); nxt int;
begin
  if not exists (select 1 from public.stages where id = p_stage) then raise exception 'NOT_FOUND'; end if;
  if not exists (select 1 from public.memberships where id = p_membership and user_id = uid) then raise exception 'NOT_MEMBER'; end if;
  perform 1 from public.games where stage_id = p_stage for share;
  if not exists (select 1 from public.games where stage_id = p_stage and started_at is not null) then
    raise exception 'TOURNAMENT_NOT_STARTED';
  end if;
  if not exists (select 1 from public.roster_slots where stage_id = p_stage and membership_id = p_membership
                 and athlete_id = p_out and not bench) then
    raise exception 'NOT_ACTIVE';
  end if;
  if not exists (select 1 from public.roster_slots where stage_id = p_stage and membership_id = p_membership
                 and athlete_id = p_in and bench) then
    raise exception 'NOT_ON_BENCH';
  end if;
  if not exists (select 1 from public.injuries where athlete_id = p_out and confirmed_at is not null
                 and (cleared_at is null or cleared_at > now())) then
    raise exception 'NOT_INJURED';
  end if;
  nxt := private.next_game(p_stage);
  insert into public.bench_swaps (stage_id, membership_id, out_athlete, in_athlete, from_game)
  values (p_stage, p_membership, p_out, p_in, nxt)
  on conflict (stage_id, membership_id) do nothing;
  if not found then raise exception 'SWAP_USED'; end if;
  perform private.audit('swap_bench', 'stage', p_stage::text,
    jsonb_build_object('membership_id', p_membership, 'out', p_out, 'in', p_in, 'from_game', nxt));
end $$;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
```

- [ ] **Step 4: Run the DB suite on its own, then the app suite**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx vitest run tests/db` (alone), then `npx vitest run src && npx tsc -b && npx eslint . && npm run build`
Expected: 169 DB tests pass (16 in rpc-tournament, 3 in rpc-gate); 210 app/core tests pass; build green.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_tournament.sql tests/db/rpc-tournament.test.ts tests/db/rpc-gate.test.ts src/app/lib/backup.ts
git commit -m "feat(db): tournament games, Swiss pairings, sealed game picks and bench swaps (0012, tournament mode T2)"
```

---

### Task 4: Final verification and hand-off (controller, not a subagent)

- [ ] Whole-branch review by **opus** against the spec (incl. amendments) and this plan's Review Focus.
- [ ] Full checks: `npx vitest run tests/db` alone, then `npx vitest run src`, `npx tsc -b`, `npx eslint .`,
  `npm run build`.
- [ ] Drop the stash (`git stash drop` on the `tournament-core-db-verified-draft` entry only).
- [ ] Go-live (user OK required): 0012 is additive and the live build never calls it, so the user can paste it into
  tribe-dev any time. Before pushing, confirm the live season's stored `roster_size` is at least 2 (amendment 9).
  Merging is safe for the live site: the app doesn't use tournament code until T3. Then merge + push, tag
  `m9-core`, update the taskboard and memory, `graphify update .`.
- [ ] Next: plan T3 (app) + T4 (retire weekly) from the same spec.
