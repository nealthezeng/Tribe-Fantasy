import { describe, expect, it, vi } from 'vitest';
import type { TournamentResult } from '../../core/tournament';
import { buildLeagueTournament, checkPairing, fetchAll, fmt, record, loadCurrentGame, mergeRanks, mergeStandings, needsYou, outStage, pastTournaments, teamLabel, toTournamentInput, type LeagueTournament, type TournamentRows } from './tournament';
import type { AuctionStage } from './auction';
import type { GameRow } from './tournament';

let mockStages: AuctionStage[] = [];
let mockGames: GameRow[] = [];

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === 'stages' ? mockStages : table === 'games' ? mockGames : [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  },
}));

const T = '2026-11-07T14:00:00+00:00';
const stage = { id: 'S1', name: 'Fall beta', starts_on: '2026-10-19', ends_on: '2026-11-15', bid_close_at: '2026-11-03T00:00:00+00:00',
  auction_seed: null, auction_run_at: '2026-11-04T00:00:00+00:00' };
const rows: TournamentRows = {
  settings: {},
  stages: [stage],
  games: [{ id: 'g1', stage_id: 'S1', number: 1, session_id: 'p1', started_at: T, finished_at: '2026-11-07T15:00:00+00:00', opponent: null },
    { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null, opponent: null }],
  pairings: [{ game_id: 'g1', home: 'm1', away: 'm2' }, { game_id: 'g2', home: 'm1', away: 'm2' }],
  members: [{ id: 'm1', team_name: 'Zeal', created_at: '2026-10-01T00:00:00+00:00', removed_at: null },
    { id: 'm2', team_name: 'Flow', created_at: '2026-10-01T00:00:00+00:00', removed_at: null }],
  slots: [{ stage_id: 'S1', membership_id: 'm1', athlete_id: 'a1', price: 10, share: 0.5, from_game: 1, until_game: null },
    { stage_id: 'S1', membership_id: 'm2', athlete_id: 'b1', price: 5, share: 0.25, from_game: 1, until_game: null }],
  picks: [{ stage_id: 'S1', game_number: 1, membership_id: 'm1', athlete_id: 'a1' }],
  sessions: [{ id: 'p1', verified_at: '2026-11-07T20:00:00+00:00' }],
  lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 1 }, points_played: 7 }],
  taps: [],
  injuries: [
    { athlete_id: 'b1', confirmed_at: '2026-10-10T00:00:00+00:00', cleared_at: '2026-10-12T00:00:00+00:00' },
    { athlete_id: 'b1', confirmed_at: null, cleared_at: null },
    { athlete_id: 'other-season', confirmed_at: '2026-10-10T00:00:00+00:00', cleared_at: null },
  ],
  outs: [],
  athletes: [{ id: 'a1', name: 'Jordan' }, { id: 'b1', name: 'Sam' }],
};

describe('toTournamentInput', () => {
  it('maps snake_case rows to the core input, keeping confirmed injuries of this season only', () => {
    const input = toTournamentInput(rows, 123);
    expect(input.now).toBe(123);
    expect(input.games[0]).toEqual({ id: 'g1', stageId: 'S1', number: 1, sessionId: 'p1', startedAt: T,
      finishedAt: '2026-11-07T15:00:00+00:00', opponent: null });
    expect(input.picks).toEqual([{ stageId: 'S1', number: 1, membershipId: 'm1', athleteId: 'a1' }]);
    expect(input.slots[0]).toEqual({ stageId: 'S1', membershipId: 'm1', athleteId: 'a1', price: 10, share: 0.5, fromGame: 1, untilGame: null });
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

  it('keeps the current tournament while the next auction takes bids (t212)', () => {
    const next = { ...stage, id: 'S2', starts_on: '2026-11-20', ends_on: '2026-11-22', bid_close_at: '2026-11-25T00:00:00+00:00', auction_run_at: null };
    expect(toTournamentInput({ ...rows, stages: [stage, next] }, Date.parse('2026-11-07T12:00:00')).currentStageId).toBe('S1');
    expect(toTournamentInput({ ...rows, stages: [stage, next] }, Date.parse('2026-11-16T12:00:00')).currentStageId).toBeNull();
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
    // Goal = 3. m2 never picked, so b1 played for them (and scored 0).
    const [m] = y.result.games[0].matchups;
    expect(m.away).toMatchObject({ membershipId: 'm2', picked: [], athleteIds: ['b1'], score: 0,
      replacements: [{ picked: null, athleteId: 'b1', why: 'missed' }] });
    expect(m.home).toMatchObject({ athleteIds: ['a1'], athleteScores: { a1: 3 }, factor: { a1: 0.5 }, points: { a1: 1.5 }, score: 1.5 });
    expect(y.result.standings[0]).toMatchObject({ membershipId: 'm1', wins: 1, place: 1 });
    expect(y.result.next).toMatchObject({ stageId: 'S1', number: 2 });
    expect(y.team.get('m1')).toBe('Zeal');
    expect(y.athlete.get('b1')).toBe('Sam');
    expect(y.out.size).toBe(0);
  });

  it('maps outs rows and lists who is out for the next game', () => {
    const outs = (from: number) => [{ stage_id: 'S1', athlete_id: 'a2', from_game: from, until_game: null }];
    const at = (from: number) => buildLeagueTournament({ ...rows, outs: outs(from) }, Date.parse('2026-11-10T12:00:00Z'));
    expect(at(2).input.outs).toEqual([{ stageId: 'S1', athleteId: 'a2', fromGame: 2, untilGame: null }]);
    expect([...at(2).out]).toEqual(['a2']); // next game is 2
    expect(at(3).out.size).toBe(0);
  });

  it('labels a removed team and maps the slot ranges', () => {
    const removed = { ...rows, members: [rows.members[0], { ...rows.members[1], removed_at: '2026-11-08T00:00:00+00:00' }],
      slots: [{ ...rows.slots[0], from_game: 2, until_game: 5 }, rows.slots[1]] };
    const y = buildLeagueTournament(removed, Date.parse('2026-11-08T00:00:00Z'));
    expect(y.team.get('m2')).toBe('Flow (removed)');
    expect(y.input.members[1].removedAt).toBe('2026-11-08T00:00:00+00:00');
    expect(y.input.slots[0]).toMatchObject({ fromGame: 2, untilGame: 5 });
  });
});

describe('owner names', () => {
  it('maps each team to its owner: a profile name, "" without a profile, "Removed user" without an account', () => {
    const T0 = '2026-10-01T00:00:00+00:00';
    const y = buildLeagueTournament({ ...rows, members: [
      { id: 'm1', team_name: 'Zeal', created_at: T0, removed_at: null, user_id: 'u1' },
      { id: 'm2', team_name: 'Huck', created_at: T0, removed_at: null, user_id: 'u2' },
      { id: 'm3', team_name: 'Gone', created_at: T0, removed_at: '2026-11-08T00:00:00+00:00', user_id: null },
    ], profiles: [{ id: 'u1', display_name: 'Neal Zeng' }] });
    expect(y.owner.get('m1')).toBe('Neal Zeng');
    expect(y.owner.get('m2')).toBe('');
    expect(y.owner.get('m3')).toBe('Removed user');
  });
});

describe('teamLabel', () => {
  it('marks only removed teams', () => {
    expect(teamLabel({ team_name: 'Zeal', removed_at: null })).toBe('Zeal');
    expect(teamLabel({ team_name: 'Zeal', removed_at: '2026-11-08T00:00:00Z' })).toBe('Zeal (removed)');
  });
});

describe('checkPairing', () => {
  const provisional = [{ league_id: 'L', order: ['m1', 'm2', 'm3', 'm4'], meetings: { 'm1|m2': 1, 'm3|m4': 1 }, season_meetings: {} }];
  it('matches the Swiss re-run, whatever order jsonb gave the keys', () => {
    // Avoiding the rematches: 1v3, 2v4.
    const pairings = [{ away: 'm3', home: 'm1', league_id: 'L' }, { away: 'm4', home: 'm2', league_id: 'L' }];
    expect(checkPairing({ pairings, provisional })).toBe(true);
  });
  it('re-runs with the season rematches too (C11)', () => {
    const pairings = [{ league_id: 'L', home: 'm1', away: 'm3' }, { league_id: 'L', home: 'm2', away: 'm4' }];
    const seasonOnly = [{ league_id: 'L', order: ['m1', 'm2', 'm3', 'm4'], meetings: {}, season_meetings: { 'm1|m2': 1, 'm3|m4': 1 } }];
    expect(checkPairing({ pairings, provisional: seasonOnly })).toBe(true);
    // A row saved before season_meetings existed re-runs without them.
    expect(checkPairing({ pairings, provisional: [{ league_id: 'L', order: ['m1', 'm2', 'm3', 'm4'], meetings: {} }] as never })).toBe(false);
  });
  it('checks a 12-team league (max_members 12)', () => {
    const order = Array.from({ length: 12 }, (_, i) => `m${i + 1}`);
    const pairings = [['m1', 'm4'], ['m2', 'm3'], ['m5', 'm6'], ['m7', 'm8'], ['m9', 'm10'], ['m11', 'm12']]
      .map(([home, away]) => ({ league_id: 'L', home, away }));
    expect(checkPairing({ pairings, provisional: [{ league_id: 'L', order, meetings: { 'm1|m2': 1 }, season_meetings: { 'm1|m3': 1, 'm3|m4': 1 } }] })).toBe(true);
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
    // 13 ids exceeds the 12-team max: would hang the tab during Swiss
    expect(checkPairing({
      pairings,
      provisional: [{ league_id: 'L', order: Array.from({ length: 13 }, (_, i) => `m${i + 1}`), meetings: {}, season_meetings: {} }],
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

describe('mergeStandings', () => {
  const league = (name: string, rows: [string, number, number][]) => ({
    name,
    y: {
      result: { standings: rows.map(([m, points, totalScore]) => ({ membershipId: m, points, totalScore, wins: 1, losses: 0, ties: 0 })) },
      team: new Map(rows.map(([m]) => [m, `Team ${m}`])),
      owner: new Map(rows.map(([m]) => [m, `Owner ${m}`])),
    } as unknown as LeagueTournament,
  });
  it('ranks every league together by points, then total score, with ties sharing a place', () => {
    const out = mergeStandings([league('A', [['a1', 10, 50], ['a2', 4, 30]]), league('B', [['b1', 12, 0], ['b2', 4, 30]])]);
    expect(out.map((r) => [r.membershipId, r.league, r.place, r.tied])).toEqual([
      ['b1', 'B', 1, false], ['a1', 'A', 2, false], ['a2', 'A', 3, true], ['b2', 'B', 3, true],
    ]);
    expect(out[0].team).toBe('Team b1');
    expect(out[0].owner).toBe('Owner b1');
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

describe('loadCurrentGame', () => {
  const baseStage = { id: 'S1', name: 'Fall beta', starts_on: '2026-10-19', ends_on: '2026-11-15', bid_close_at: '2026-11-03T00:00:00+00:00',
    auction_seed: null, auction_run_at: '2026-11-04T00:00:00+00:00' };

  it("still returns a live game after the tournament's last day, so it can be finished", async () => {
    mockStages = [baseStage];
    mockGames = [{ id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: '2026-11-15T14:00:00+00:00', finished_at: null, opponent: null }];
    const result = await loadCurrentGame('se', Date.parse('2026-11-16T12:00:00'));
    expect(result?.game.id).toBe('g2');
  });

  it("has no game to start after the tournament's last day", async () => {
    mockStages = [baseStage];
    mockGames = [{ id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null, opponent: null }];
    const result = await loadCurrentGame('se', Date.parse('2026-11-16T12:00:00'));
    expect(result).toBeNull();
  });

  it('starts an auctioned tournament while a later one is still taking bids (t212)', async () => {
    const dry = { ...baseStage, id: 'D', starts_on: '2026-10-17', ends_on: '2026-10-18', bid_close_at: '2026-10-16T20:00:00+00:00' };
    const open = { ...baseStage, starts_on: '2026-11-07', ends_on: '2026-11-08', auction_run_at: null };
    mockStages = [open, dry];
    mockGames = [{ id: 'd1', stage_id: 'D', number: 1, session_id: null, started_at: null, finished_at: null, opponent: null }];
    const result = await loadCurrentGame('se', Date.parse('2026-10-17T12:00:00'));
    expect(result?.stage.id).toBe('D');
    expect(result?.game.id).toBe('d1');
  });

  it('returns the next game to start on the last day', async () => {
    mockStages = [baseStage];
    mockGames = [{ id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null, opponent: null }];
    const result = await loadCurrentGame('se', Date.parse('2026-11-15T12:00:00'));
    expect(result?.game.id).toBe('g2');
  });

  const g = (n: number, finished: boolean): GameRow => ({ id: `g${n}`, stage_id: 'S1', number: n, session_id: null,
    started_at: finished ? '2026-11-07T14:00:00+00:00' : null, finished_at: finished ? '2026-11-07T15:00:00+00:00' : null, opponent: null });

  it('returns the first unfinished game, with every game and the count', async () => {
    mockStages = [baseStage];
    mockGames = [g(1, true), g(2, false), g(3, false)];
    const result = await loadCurrentGame('se', Date.parse('2026-11-07T12:00:00'));
    expect(result?.game.id).toBe('g2');
    expect(result?.count).toBe(3);
    expect(result?.games.map((x) => x.id)).toEqual(['g1', 'g2', 'g3']);
  });

  it('returns the last game when all are finished (the "is over" line)', async () => {
    mockStages = [baseStage];
    mockGames = [g(1, true), g(2, true), g(3, true)];
    const result = await loadCurrentGame('se', Date.parse('2026-11-07T12:00:00'));
    expect(result?.game.id).toBe('g3');
    expect(result?.count).toBe(3);
  });
});

describe('needsYou', () => {
  const NOW = Date.parse('2026-10-11T12:00:00Z');
  const row = (membershipId: string, wins: number, place: number, tied = false) =>
    ({ membershipId, wins, losses: 0, ties: 0, place, tied, points: wins, totalScore: 0 });
  const y = (over: object) => ({ settings: { picks_per_game: 2 }, result: { standings: [row('m1', 0, 1, true), row('m2', 0, 1, true)], games: [], next: null, ...over } }) as unknown as LeagueTournament;
  const open = { stage: { bid_close_at: '2026-10-13T12:00:00Z', auction_run_at: null }, bids: 0 };

  it('flags an open auction you have not bid in, and nothing once you have or it closed', () => {
    expect(needsYou(y({}), 'm1', open, NOW)).toBe(true);
    expect(needsYou(y({}), 'm1', { ...open, bids: 2 }, NOW)).toBe(false);
    expect(needsYou(y({}), 'm1', open, Date.parse('2026-10-14T12:00:00Z'))).toBe(false);
    expect(needsYou(y({}), 'm1', null, NOW)).toBe(false);
  });

  it('flags missing picks for the next game, not a live game', () => {
    const live = { status: 'live', game: { number: 2 }, matchups: [{ home: { membershipId: 'm2' }, away: { membershipId: 'm1' } }] };
    const next = (picked: string[], players = ['a1', 'a2', 'a3']) => ({ stageId: 's', number: 3, sides: [{ membershipId: 'm1', picked, players }] });
    expect(needsYou(y({ games: [live], next: next([]) }), 'm1', null, NOW)).toBe(true);
    expect(needsYou(y({ games: [live], next: next(['a1']) }), 'm1', null, NOW)).toBe(true); // 1 of 2
    expect(needsYou(y({ games: [live], next: next(['a1', 'a2']) }), 'm1', null, NOW)).toBe(false);
    expect(needsYou(y({ games: [live], next: next(['a1'], ['a1']) }), 'm1', null, NOW)).toBe(false); // a 1-player roster is set
  });
});

describe('fmt and record', () => {
  it('formats points and records', () => {
    expect(fmt(2.345)).toBe('2.35'); expect(record({ wins: 2, losses: 1, ties: 0 })).toBe('2–1');
    expect(record({ wins: 2, losses: 1, ties: 1 })).toBe('2–1–1');
  });
});

describe('pastTournaments', () => {
  const side = (membershipId: string, delta: number, score: number, result: 'W' | 'L' | 'T' | null) => ({ membershipId, delta, score, result });
  const game = (stageId: string, number: number, status: string, matchups: unknown[] = []) => ({ game: { id: `${stageId}-${number}`, stageId, number }, status, matchups });
  const names = new Map([['m1', 'Zeal'], ['m2', 'Flow'], ['m3', 'Bye'], ['m4', 'Late']]);
  const build = (next: { stageId: string } | null) => ({
    result: { standings: [], next, games: [
      game('S1', 1, 'final', [{ home: side('m1', 3, 40, 'W'), away: side('m2', -1, 30, 'L') }, { home: side('m3', 1, 0, null), away: null }]),
      game('S1', 2, 'pending'),
      game('S1', 3, 'upcoming'),
      game('S2', 1, 'final', [{ home: side('m4', 2, 20, 'W'), away: side('m1', 0, 10, 'L') }]),
    ] },
    team: names, owner: new Map(), stage: new Map([['S1', 'Warmup'], ['S2', 'Feast']]),
    stageDates: new Map([['S1', { starts_on: '2026-10-10', ends_on: '2026-10-11' }], ['S2', { starts_on: '2026-11-07', ends_on: '2026-11-08' }]]),
  }) as unknown as LeagueTournament;

  it('lists finished tournaments newest first, leaving out the one being played', () => {
    expect(pastTournaments(build({ stageId: 'S2' })).map((t) => t.stageId)).toEqual(['S1']);
  });
  it("ranks a tournament's teams by the points its final games gave, byes included, late joiners absent", () => {
    const [s1] = pastTournaments(build({ stageId: 'S2' }));
    expect(s1).toMatchObject({ name: 'Warmup', starts_on: '2026-10-10', ends_on: '2026-10-11', waiting: true });
    expect(s1.rows.map((r) => [r.membershipId, r.points, record(r)])).toEqual([['m1', 3, '1–0'], ['m3', 1, '0–0'], ['m2', -1, '0–1']]);
  });
  it('lists a tournament whose only started game is void, with no rows', () => {
    const y = build(null);
    y.result.games.push(game('S3', 1, 'void') as never);
    y.stage.set('S3', 'Void cup');
    y.stageDates.set('S3', { starts_on: '2026-12-01', ends_on: '2026-12-02' });
    expect(pastTournaments(y)[0]).toMatchObject({ stageId: 'S3', rows: [], waiting: false });
  });
  it('lists every played tournament between tournaments (no next game)', () => {
    const all = pastTournaments(build(null));
    expect(all.map((t) => t.stageId)).toEqual(['S2', 'S1']);
    expect(all[0].waiting).toBe(false);
  });
});

describe('outStage', () => {
  const cccs = { starts_on: '2026-11-07', ends_on: '2026-11-08' };
  const later = { starts_on: '2026-11-21', ends_on: '2026-11-22' };
  const done = { starts_on: '2026-10-17', ends_on: '2026-10-18' };
  it('picks the playing tournament over a later one, the next one between, and none after the last', () => {
    expect(outStage([later, cccs, done], '2026-11-08')).toBe(cccs);
    expect(outStage([later, cccs, done], '2026-11-09')).toBe(later);
    expect(outStage([later, cccs, done], '2026-11-23')).toBeNull();
  });
});
