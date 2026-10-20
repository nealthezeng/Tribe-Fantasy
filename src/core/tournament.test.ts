import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { liveStatLines, nextPairings, pairingInputs, scoreTournaments, type TournamentGame, type TournamentInput, type YearStatLine } from './tournament';

// Fixed points (upset_k 0: win +3, loss −1), 1 point per goal, no tournament doubling, no decay or tiredness: easy arithmetic.
const s = parseSettings({ upset_k: 0, stat_weights: { goal: 1 }, session_multipliers: { practice: 1, tournament: 1 },
  decay_mode: 'none', tiredness_multipliers: [] });
/** The 1-pick games most tests below were written for, with tiredness on. */
const one = { ...s, picks_per_game: 1, tiredness_multipliers: [0.5, 0.75] };
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
const roster = (stageId: string, m: string, ids: string[], shares: number[] = []) =>
  ids.map((athleteId, i) => ({ stageId, membershipId: m, athleteId, price: 10, share: shares[i] ?? 1, fromGame: 1, untilGame: null }));
const pick = (number: number, membershipId: string, athleteId: string, stageId = 'S1') => ({ stageId, number, membershipId, athleteId });

/** Two teams, three games of S1, one pick each. m1 roster a1–a3, m2 b1–b3. */
const base = (over: Partial<TournamentInput> = {}): TournamentInput => {
  const games = over.games ?? [game(1), game(2), game(3)];
  return {
    settings: one,
    now: NOW,
    games,
    pairings: games.map((g) => ({ gameId: g.id, home: 'm1', away: 'm2' })),
    members: [{ id: 'm1', createdAt: '2026-10-01T00:00:00Z', removedAt: null }, { id: 'm2', createdAt: '2026-10-01T00:00:00Z', removedAt: null }],
    slots: [...roster('S1', 'm1', ['a1', 'a2', 'a3']), ...roster('S1', 'm2', ['b1', 'b2', 'b3'])],
    picks: [pick(1, 'm1', 'a1'), pick(1, 'm2', 'b1'), pick(2, 'm1', 'a2'), pick(2, 'm2', 'b2'), pick(3, 'm1', 'a3'), pick(3, 'm2', 'b3')],
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

describe('scoreTournaments, 2v2', () => {
  it('scores 2v2 by share: both sides may start the same player', () => {
    const r = scoreTournaments(base({
      settings: s,
      games: [game(1)],
      slots: [...roster('S1', 'm1', ['a1', 'a2'], [0.5, 1]), ...roster('S1', 'm2', ['a1', 'b1'], [0.5, 1])],
      picks: [pick(1, 'm1', 'a1'), pick(1, 'm1', 'a2'), pick(1, 'm2', 'a1'), pick(1, 'm2', 'b1')],
      statLines: [goals('S1s1', 'a1', 10), goals('S1s1', 'a2', 4), goals('S1s1', 'b1', 3)],
    }));
    expect(side(r, 'S1g1', 'm1')).toMatchObject({ athleteIds: ['a1', 'a2'], points: { a1: 5, a2: 4 }, score: 9, result: 'W' });
    expect(side(r, 'S1g1', 'm2')).toMatchObject({ points: { a1: 5, b1: 3 }, score: 8, result: 'L' });
  });

  it('fills empty and injured picks: most rested, then share × form', () => {
    const at = (picks: string[]) => side(scoreTournaments(base({
      settings: s,
      games: [game(1)],
      slots: [...roster('S1', 'm1', ['a1', 'a2', 'a3']), ...roster('S1', 'm2', ['b1', 'b2'])],
      picks: picks.map((a) => pick(1, 'm1', a)),
      injuries: [{ athleteId: 'a2', confirmedAt: iso(T0), clearedAt: null }],
    })), 'S1g1', 'm1');
    expect(at(['a1'])).toMatchObject({ athleteIds: ['a1', 'a3'], replacements: [{ picked: null, athleteId: 'a3', why: 'missed' }] });
    expect(at(['a1', 'a2'])).toMatchObject({ picked: ['a1', 'a2'], athleteIds: ['a1', 'a3'],
      replacements: [{ picked: 'a2', athleteId: 'a3', why: 'injured' }] });
    // A pick off the roster is ignored: the slot is filled as if missed.
    expect(at(['a1', 'b1']).replacements).toEqual([{ picked: null, athleteId: 'a3', why: 'missed' }]);
  });

  it('short roster: one player starts alone, no players is a forfeit', () => {
    const r = scoreTournaments(base({ settings: s, games: [game(1)], slots: roster('S1', 'm1', ['a1']), picks: [] }));
    expect(side(r, 'S1g1', 'm1').athleteIds).toEqual(['a1']);
    expect(side(r, 'S1g1', 'm2')).toMatchObject({ athleteIds: [], replacements: [], score: 0, result: 'L' });
  });

  it('factor is share × rest × decay for every player', () => {
    const r = scoreTournaments(base({
      settings: { ...s, tiredness_multipliers: [0.5] },
      games: [game(1), game(2, 'S1', { sessionId: null, startedAt: null, finishedAt: null })],
      slots: [...roster('S1', 'm1', ['a1', 'a2', 'a3'], [0.5, 1, 0.4]), ...roster('S1', 'm2', ['b1', 'b2'])],
      picks: [pick(1, 'm1', 'a1'), pick(1, 'm1', 'a2')],
      currentStageId: 'S1',
    }));
    const m1 = r.next!.sides.find((x) => x.membershipId === 'm1')!;
    expect(m1.factor.a1).toBe(0.25);
    expect(m1.factor.a3).toBe(m1.share.a3);
    expect(m1.players).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('scoreTournaments', () => {
  it('scores final games in order and keeps a W-L-T table', () => {
    const r = scoreTournaments(base());
    expect(r.games.map((g) => g.status)).toEqual(['final', 'final', 'final']);
    expect(side(r, 'S1g1', 'm1')).toMatchObject({ athleteIds: ['a1'], replacements: [], athleteScores: { a1: 4 }, points: { a1: 4 },
      score: 4, delta: 3, result: 'W' });
    expect(side(r, 'S1g1', 'm1').factor).toEqual({ a1: 1, a2: 1, a3: 1 });
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
    expect([1, 2, 4].map((n) => side(r, `S1g${n}`, 'm1').rest.a1)).toEqual([1, 0.5, 0.75]);
    expect(side(r, 'S1g2', 'm1')).toMatchObject({ athleteScores: { a1: 4 }, score: 2 });
    expect(side(r, 'S1g4', 'm2').rest.b1).toBe(1); // cycling all three never tires (gap 3)
  });

  it('auto-picks a missed pick: the most rested athlete, even over a better recent average', () => {
    const r = scoreTournaments(base({ picks: base().picks.filter((p) => !(p.number === 2 && p.membershipId === 'm1')) }));
    // a1 started game 1 (×0.5); a2 and a3 are rested and have no history: lowest id.
    expect(side(r, 'S1g2', 'm1')).toMatchObject({ picked: [], athleteIds: ['a2'],
      replacements: [{ picked: null, athleteId: 'a2', why: 'missed' }] });
  });

  it('swaps out a pick injured at the start', () => {
    const r = scoreTournaments(base({ injuries: [{ athleteId: 'a2', confirmedAt: iso(T0), clearedAt: null }] }));
    expect(side(r, 'S1g2', 'm1')).toMatchObject({ picked: ['a2'], athleteIds: ['a3'],
      replacements: [{ picked: 'a2', athleteId: 'a3', why: 'injured' }] });
  });

  it('ignores an injury confirmed after the start', () => {
    const r = scoreTournaments(base({ injuries: [{ athleteId: 'a2', confirmedAt: iso(T0 + 4.5 * H), clearedAt: null }] }));
    expect(side(r, 'S1g2', 'm1')).toMatchObject({ athleteIds: ['a2'], replacements: [] });
  });

  it('forfeits a missed pick when default_pick is forfeit', () => {
    const r = scoreTournaments(base({
      settings: { ...one, default_pick: 'forfeit' },
      picks: base().picks.filter((p) => !(p.number === 1 && p.membershipId === 'm1')),
    }));
    expect(side(r, 'S1g1', 'm1')).toMatchObject({ athleteIds: [], replacements: [{ picked: null, athleteId: null, why: 'missed' }],
      score: 0, result: 'L' });
  });

  it('holds later games back behind a live or pending one; a void game holds nothing and scores nothing', () => {
    const live = base({ games: [game(1), game(2, 'S1', { finishedAt: null }), game(3)] });
    live.sessions = live.sessions.map((x) => (x.id === 'S1s2' ? { ...x, verifiedAt: null } : x));
    expect(scoreTournaments(live).games.map((g) => g.status)).toEqual(['final', 'live', 'pending']);

    const pending = base();
    pending.sessions = pending.sessions.map((x) => (x.id === 'S1s1' ? { ...x, verifiedAt: null } : x));
    expect(scoreTournaments(pending).games.map((g) => g.status)).toEqual(['pending', 'pending', 'pending']);

    // Verified counts at once: the stat lock only governs reopen/corrections (t122).
    const fresh = base();
    fresh.sessions = fresh.sessions.map((x) => (x.id === 'S1s1' ? { ...x, verifiedAt: iso(NOW - H) } : x));
    expect(scoreTournaments(fresh).games.map((g) => g.status)).toEqual(['final', 'final', 'final']);

    const v = scoreTournaments(base({ games: [game(1), game(2, 'S1', { sessionId: null }), game(3)] }));
    expect(v.games.map((g) => g.status)).toEqual(['final', 'void', 'final']);
    expect(side(v, 'S1g2', 'm1')).toMatchObject({ delta: null, points: null });
    const again = scoreTournaments(base({
      games: [game(1), game(2, 'S1', { sessionId: null }), game(3)],
      picks: [...base().picks.filter((p) => p.number !== 3), pick(3, 'm1', 'a2'), pick(3, 'm2', 'b3')],
    }));
    expect(side(again, 'S1g3', 'm1').rest.a2).toBe(1); // a2's game-2 start was void, so it doesn't count
  });

  it('marks a not-started game upcoming and resolves its picks as of now', () => {
    const r = scoreTournaments(base({ games: [game(1), game(2), game(3), game(4, 'S1', { sessionId: null, startedAt: null, finishedAt: null })],
      pairings: [1, 2, 3, 4].map((n) => ({ gameId: `S1g${n}`, home: 'm1', away: 'm2' })) }));
    expect(r.games.at(-1)!.status).toBe('upcoming');
    expect(side(r, 'S1g4', 'm1')).toMatchObject({ picked: [], athleteIds: ['a1'],
      replacements: [{ picked: null, athleteId: 'a1', why: 'missed' }], score: null, points: null });
    expect(side(r, 'S1g4', 'm1').rest).toEqual({ a1: 1, a2: 0.75, a3: 0.5 });
  });

  it('counts a started game as final only when provisional', () => {
    const b = base({ games: [game(1), game(2), game(3, 'S1', { finishedAt: null })] });
    b.sessions = b.sessions.map((x) => ({ ...x, verifiedAt: null }));
    expect(scoreTournaments(b).games.map((g) => g.status)).toEqual(['pending', 'pending', 'live']);
    const p = scoreTournaments(b, { provisional: true });
    expect(p.games.map((g) => g.status)).toEqual(['final', 'final', 'final']);
    expect(p.standings.find((x) => x.membershipId === 'm1')!.points).toBe(3);
  });

  it('scores a bye as a final side with no points move', () => {
    const g1 = game(1);
    const r = scoreTournaments(base({
      games: [g1],
      pairings: [{ gameId: g1.id, home: 'm1', away: 'm2' }, { gameId: g1.id, home: 'm3', away: null }],
      members: ['m1', 'm2', 'm3'].map((id) => ({ id, createdAt: '2026-10-01T00:00:00Z', removedAt: null })),
      slots: [...base().slots, ...roster('S1', 'm3', ['c1', 'c2', 'c3'])],
      statLines: [goals('S1s1', 'a1', 4), goals('S1s1', 'b1', 2), goals('S1s1', 'c1', 3), goals('S1s1', 'c2', 3), goals('S1s1', 'c3', 3)],
    }));
    expect(r.games[0].status).toBe('final');
    expect(side(r, 'S1g1', 'm3')).toMatchObject({ score: 3, delta: 0, result: null });
    expect(r.standings.find((x) => x.membershipId === 'm3')).toMatchObject({ points: 0, wins: 0, losses: 0, ties: 0, totalScore: 3 });
  });

  it('forfeits a paired manager with no roster in the stage', () => {
    const g1 = game(1);
    const r = scoreTournaments(base({
      games: [g1],
      pairings: [{ gameId: g1.id, home: 'm1', away: 'm2' }],
      slots: roster('S1', 'm1', ['a1', 'a2', 'a3']),
    }));
    expect(side(r, 'S1g1', 'm2')).toMatchObject({ athleteIds: [], replacements: [], players: [], score: 0, result: 'L' });
    expect(side(r, 'S1g1', 'm1')).toMatchObject({ result: 'W' });
    expect(r.standings.find((x) => x.membershipId === 'm1')).toMatchObject({ wins: 1, losses: 0 });
    expect(r.standings.find((x) => x.membershipId === 'm2')).toMatchObject({ wins: 0, losses: 1 });
  });

  it('degrades a pair started in an earlier tournament (stage decay, grace 0)', () => {
    const g = [game(1), game(1, 'S2')];
    const r = scoreTournaments(base({
      settings: { ...one, decay_mode: 'exponential', decay_grace_stages: 0 },
      games: g,
      pairings: g.map((x) => ({ gameId: x.id, home: 'm1', away: 'm2' })),
      sessions: g.map((x) => ({ id: x.sessionId!, verifiedAt: verifiedAt(x) })),
      slots: [...base().slots, ...roster('S2', 'm1', ['a1', 'a2', 'a3']), ...roster('S2', 'm2', ['b1', 'b2', 'b3'])],
      picks: [pick(1, 'm1', 'a1'), pick(1, 'm2', 'b1'), pick(1, 'm1', 'a1', 'S2'), pick(1, 'm2', 'b2', 'S2')],
      statLines: [goals('S2s1', 'a1', 10)],
    }));
    // Tiredness resets each tournament; the earlier tournament's start costs ×0.9, and it shows on every player.
    expect(side(r, 'S2g1', 'm1')).toMatchObject({ rest: { a1: 1 }, decay: { a1: 0.9, a2: 1 }, score: 9 });
    expect(side(r, 'S2g1', 'm2').decay).toMatchObject({ b1: 0.9, b2: 1 });
  });

  it('describes the next game of the current stage, with pre-selected picks and tiredness', () => {
    // Finishing game 3 created game 4, unstarted.
    const games = [game(1), game(2), game(3), game(4, 'S1', { sessionId: null, startedAt: null, finishedAt: null })];
    const r = scoreTournaments(base({ games, currentStageId: 'S1', picks: [...base().picks, pick(4, 'm1', 'a3')] }));
    expect(r.next).toMatchObject({ stageId: 'S1', number: 4 });
    expect(r.next!.sides.find((x) => x.membershipId === 'm1')).toMatchObject({
      picked: ['a3'], athleteIds: ['a3'], replacements: [], rest: { a1: 1, a2: 0.75, a3: 0.5 }, factor: { a3: 0.5 },
    });
    const before = scoreTournaments(base({ games: [], pairings: [], currentStageId: 'S1' }));
    expect(before.next).toMatchObject({ number: 1 });
    expect(before.next!.sides.map((x) => x.membershipId)).toEqual(['m1', 'm2']);
  });

  it('has no next game once every game of the tournament is finished: game 3 was the last (t202)', () => {
    expect(scoreTournaments(base({ currentStageId: 'S1' })).next).toBeNull();
    const live = [game(1), game(2), game(3, 'S1', { finishedAt: null })];
    expect(scoreTournaments(base({ games: live, currentStageId: 'S1' })).next).toMatchObject({ number: 4 });
  });
});

describe('nextPairings', () => {
  const four = (over: Partial<TournamentInput> = {}) => {
    const g1 = game(1, 'S1', { finishedAt: null }); // nextPairings runs before finish_game marks the game finished
    return base({
      games: [g1],
      pairings: [{ gameId: g1.id, home: 'm1', away: 'm2' }, { gameId: g1.id, home: 'm3', away: 'm4' }],
      members: ['m1', 'm2', 'm3', 'm4'].map((id) => ({ id, createdAt: '2026-10-01T00:00:00Z', removedAt: null })),
      slots: [...roster('S1', 'm1', ['a1']), ...roster('S1', 'm2', ['b1']), ...roster('S1', 'm3', ['c1']), ...roster('S1', 'm4', ['d1'])],
      picks: [],
      sessions: [{ id: g1.sessionId!, verifiedAt: null }],
      statLines: [goals('S1s1', 'a1', 5), goals('S1s1', 'b1', 1), goals('S1s1', 'c1', 1), goals('S1s1', 'd1', 4)],
      now: Date.parse(g1.startedAt!) + H,
      currentStageId: 'S1',
      ...over,
    });
  };

  it('pairs winners with winners on provisional results, avoiding rematches', () => {
    // m1 and m4 won game 1 (unverified): they meet; m2 and m3 meet.
    expect(nextPairings(four())).toEqual([['m1', 'm4'], ['m2', 'm3']]);
  });

  it('leaves out a team that joins after now, and gives an odd count a bye', () => {
    const f = four();
    const late = nextPairings({ ...f, members: [...f.members, { id: 'm5', createdAt: '2027-06-01T00:00:00Z', removedAt: null }] });
    expect(late.flat()).not.toContain('m5');
    const joined = nextPairings({ ...f, members: [...f.members, { id: 'm5', createdAt: '2026-10-02T00:00:00Z', removedAt: null }] });
    // m5 (0 points, never paired) ties the losers; the lowest-placed team without a bye sits out.
    expect(joined).toHaveLength(3);
    expect(joined.filter(([, b]) => b === null)).toHaveLength(1);
    expect(joined.flat().filter((x) => x !== null).sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('exposes the standings order and meetings it pairs from', () => {
    // m1 (5 goals) and m4 (4) won game 1; m2 and m3 lost on 1 goal each, so id breaks the tie.
    const met = { 'm1|m2': 1, 'm3|m4': 1 };
    expect(pairingInputs(four())).toEqual({ order: ['m1', 'm4', 'm2', 'm3'], meetings: met, seasonMeetings: met });
    expect(pairingInputs(four({ currentStageId: null })).meetings).toEqual({});
  });

  it('pairingInputs splits tournament and season meetings', () => {
    const f = four();
    const g2 = game(1, 'S2', { finishedAt: null });
    const r = pairingInputs({ ...f, currentStageId: 'S2', now: Date.parse(g2.startedAt!) + H,
      games: [{ ...f.games[0], finishedAt: f.games[0].startedAt }, g2],
      pairings: [...f.pairings, { gameId: g2.id, home: 'm1', away: 'm3' }, { gameId: g2.id, home: 'm2', away: 'm4' }] });
    expect(r.meetings).toEqual({ 'm1|m3': 1, 'm2|m4': 1 });
    expect(r.seasonMeetings).toEqual({ 'm1|m2': 1, 'm3|m4': 1, 'm1|m3': 1, 'm2|m4': 1 });
  });

  it('ignores pairings of a game that never started', () => {
    const ghost = game(2, 'S1', { sessionId: null, startedAt: null, finishedAt: null });
    const f = four();
    const r = nextPairings({ ...f, games: [...f.games, ghost],
      pairings: [...f.pairings, { gameId: ghost.id, home: 'm1', away: 'm4' }, { gameId: ghost.id, home: 'm2', away: 'm3' }] });
    expect(r).toEqual([['m1', 'm4'], ['m2', 'm3']]);
  });
});

describe('slot ranges and removed teams (M14)', () => {
  const ranged = (m: string, athleteId: string, fromGame: number, untilGame: number | null) =>
    ({ stageId: 'S1', membershipId: m, athleteId, price: 10, share: 1, fromGame, untilGame });
  const withRemoved = (id: string, removedAt: string | null) => (x: { id: string; createdAt: string; removedAt: string | null }) =>
    (x.id === id ? { ...x, removedAt } : x);

  it('slot ending at game 3 still scores games 1–2', () => {
    // a1 is m1's only player, until game 3; goals in games 1 and 2, none in 3.
    const r = scoreTournaments(base({
      slots: [ranged('m1', 'a1', 1, 3), ...roster('S1', 'm2', ['b1', 'b2', 'b3'])],
      picks: [pick(1, 'm1', 'a1'), pick(2, 'm1', 'a1'), pick(3, 'm1', 'a1')],
      statLines: [goals('S1s1', 'a1', 4), goals('S1s2', 'a1', 2), goals('S1s3', 'a1', 9)],
    }));
    expect(side(r, 'S1g1', 'm1')).toMatchObject({ players: ['a1'], athleteIds: ['a1'], score: 4 });
    expect(side(r, 'S1g2', 'm1')).toMatchObject({ players: ['a1'], score: 1 }); // 2 goals × 0.5 rest (started game 1)
    expect(side(r, 'S1g3', 'm1')).toMatchObject({ players: [], athleteIds: [], score: 0 });
  });

  it('slot starting at game 2 is not on the game-1 roster', () => {
    const r = scoreTournaments(base({ slots: [ranged('m1', 'a1', 2, null), ...roster('S1', 'm2', ['b1', 'b2', 'b3'])] }));
    expect(side(r, 'S1g1', 'm1').players).toEqual([]);
    expect(side(r, 'S1g2', 'm1').players).toEqual(['a1']);
  });

  it('a removed team forfeits its paired game', () => {
    const r = scoreTournaments(base({ members: base().members.map(withRemoved('m1', iso(T0 + 3 * H))) }));
    expect(side(r, 'S1g1', 'm1').score).toBe(4); // played before it was removed
    expect(side(r, 'S1g2', 'm1')).toMatchObject({ players: [], athleteIds: [], score: 0 });
    expect(side(r, 'S1g2', 'm2').score).toBe(3);
  });

  const nextBase = () => {
    const g1 = game(1, 'S1', { finishedAt: null });
    return base({
      games: [g1],
      pairings: [{ gameId: g1.id, home: 'm1', away: 'm2' }, { gameId: g1.id, home: 'm3', away: 'm4' }],
      members: ['m1', 'm2', 'm3', 'm4'].map((id) => ({ id, createdAt: '2026-10-01T00:00:00Z', removedAt: null })),
      slots: [...roster('S1', 'm1', ['a1']), ...roster('S1', 'm2', ['b1']), ...roster('S1', 'm3', ['c1']), ...roster('S1', 'm4', ['d1'])],
      picks: [],
      sessions: [{ id: g1.sessionId!, verifiedAt: null }],
      statLines: [goals('S1s1', 'a1', 5), goals('S1s1', 'b1', 1), goals('S1s1', 'c1', 1), goals('S1s1', 'd1', 4)],
      now: Date.parse(g1.startedAt!) + H,
      currentStageId: 'S1',
    });
  };

  it('nextPairings leaves out removed teams', () => {
    const f = nextBase();
    const gone = { ...f, members: f.members.map(withRemoved('m4', iso(f.now - 1))) };
    const { order } = pairingInputs(gone);
    expect(order).not.toContain('m4');
    expect(nextPairings(gone).flat()).not.toContain('m4');
    expect(pairingInputs({ ...f, members: f.members.map(withRemoved('m4', iso(f.now + H))) }).order).toContain('m4');
  });

  it('next.sides leaves out removed teams', () => {
    const f = nextBase();
    const ids = (input: TournamentInput) => scoreTournaments(input).next!.sides.map((x) => x.membershipId);
    expect(ids({ ...f, members: f.members.map(withRemoved('m2', iso(f.now - 1))) })).toEqual(['m1', 'm3', 'm4']);
    expect(ids(f)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('one removed member is out of both pairing and next.sides, and one never removed is in both', () => {
    const f = nextBase();
    const sides = (input: TournamentInput) => scoreTournaments(input).next!.sides.map((x) => x.membershipId);
    const gone = { ...f, members: f.members.map(withRemoved('m3', iso(f.now))) }; // removed exactly now
    expect(pairingInputs(gone).order).not.toContain('m3');
    expect(sides(gone)).not.toContain('m3');
    expect(pairingInputs(f).order).toContain('m3');
    expect(sides(f)).toContain('m3');
  });

  it('next.sides uses the slots live at the next game', () => {
    const f = nextBase();
    const slots = [ranged('m1', 'a1', 1, 2), ranged('m1', 'a2', 2, null), ...f.slots.filter((x) => x.membershipId !== 'm1')];
    const sides = scoreTournaments({ ...f, slots }).next!.sides;
    expect(sides.find((x) => x.membershipId === 'm1')!.players).toEqual(['a2']); // game 1 started, so game 2 is next: a1 ended at 2, a2 starts at 2
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
