import { describe, expect, it } from 'vitest';
import type { TournamentResult } from '../../core/tournament';
import { buildLeagueTournament, checkPairing, fetchAll, mergeRanks, toTournamentInput, type TournamentRows } from './tournament';

const T = '2026-11-07T14:00:00+00:00';
const stage = { id: 'S1', name: 'Fall beta', starts_on: '2026-10-19', ends_on: '2026-11-15', bid_close_at: '2026-11-03T00:00:00+00:00',
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

  it("has no current stage once the tournament's last day has passed (T4)", () => {
    const at = (iso: string) => toTournamentInput(rows, Date.parse(iso)).currentStageId;
    expect(at('2026-11-15T12:00:00')).toBe('S1'); // local time: the last day
    expect(at('2026-11-16T12:00:00')).toBeNull();
  });
});

describe('buildLeagueTournament', () => {
  it('scores the year and carries names for the UI', () => {
    const y = buildLeagueTournament(rows, Date.parse('2026-11-10T12:00:00Z')); // game 1's stats locked, tournament not over
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
  it('reports a mismatch for malformed audit row (missing order, junk order, null entry)', () => {
    const pairings = [{ away: 'm3', home: 'm1', league_id: 'L' }];
    expect(checkPairing({ pairings, provisional: [{}] as never })).toBe(false); // missing order
    expect(checkPairing({ pairings, provisional: [null] as never })).toBe(false); // null entry
    // 9 ids exceeds the 8-team max: would hang the tab during Swiss
    expect(checkPairing({
      pairings,
      provisional: [{ league_id: 'L', order: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'], meetings: {} }],
    })).toBe(false);
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
