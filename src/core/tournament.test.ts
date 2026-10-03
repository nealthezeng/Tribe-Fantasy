import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { lineup, liveStatLines, nextPairings, pairingInputs, scoreTournaments, type TournamentGame, type TournamentInput, type YearStatLine } from './tournament';

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
    // a2's game-2 start was void, so a2 in game 3 is not a game on from it.
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
      members: ['m1', 'm2', 'm3'].map((id) => ({ id, createdAt: '2026-10-01T00:00:00Z' })),
      slots: [...base().slots, ...roster('S1', 'm3', ['c1', 'c2', 'c3', 'c4'])],
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
      slots: roster('S1', 'm1', ['a1', 'a2', 'a3', 'a4']),
    }));
    expect(side(r, 'S1g1', 'm2')).toMatchObject({ athleteId: null, notice: 'inactive', score: 0, result: 'L' });
    expect(side(r, 'S1g1', 'm1')).toMatchObject({ result: 'W' });
    expect(r.standings.find((x) => x.membershipId === 'm1')).toMatchObject({ wins: 1, losses: 0 });
    expect(r.standings.find((x) => x.membershipId === 'm2')).toMatchObject({ wins: 0, losses: 1 });
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
    const g1 = game(1, 'S1', { finishedAt: null }); // nextPairings runs before finish_game marks the game finished
    return base({
      games: [g1],
      pairings: [{ gameId: g1.id, home: 'm1', away: 'm2' }, { gameId: g1.id, home: 'm3', away: 'm4' }],
      members: ['m1', 'm2', 'm3', 'm4'].map((id) => ({ id, createdAt: '2026-10-01T00:00:00Z' })),
      slots: [...roster('S1', 'm1', ['a1']), ...roster('S1', 'm2', ['b1']), ...roster('S1', 'm3', ['c1']), ...roster('S1', 'm4', ['d1'])],
      picks: [],
      sessions: [{ id: g1.sessionId!, verifiedAt: null }],
      statLines: [goals('S1s1', 'a1', 5), goals('S1s1', 'b1', 1), goals('S1s1', 'c1', 1), goals('S1s1', 'd1', 4)],
      now: Date.parse(g1.startedAt!) + H,
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

  it('exposes the standings order and meetings it pairs from', () => {
    // m1 (5 goals) and m4 (4) won game 1; m2 and m3 lost on 1 goal each, so id breaks the tie.
    expect(pairingInputs(four())).toEqual({ order: ['m1', 'm4', 'm2', 'm3'], meetings: { 'm1|m2': 1, 'm3|m4': 1 } });
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
