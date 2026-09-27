import { describe, expect, it } from 'vitest';
import { buildLeagueYear, fetchAll, toYearInput, type LeagueRows } from './weekly';

const rows: LeagueRows = {
  settings: {},
  stages: [{ id: 'S1', name: 'Fall beta' }],
  weeks: [{ id: 'w1', stage_id: 'S1', starts_on: '2026-10-19', ends_on: '2026-10-25', starts_at: '2026-10-19T04:00:00+00:00',
    ends_at: '2026-10-26T04:00:00+00:00', pick_lock_at: '2026-10-20T01:00:00+00:00' }],
  members: [{ id: 'm1', team_name: 'Zeal', created_at: '2026-10-01T00:00:00+00:00' },
    { id: 'm2', team_name: 'Flow', created_at: '2026-10-01T00:00:00+00:00' }],
  slots: [{ stage_id: 'S1', membership_id: 'm1', athlete_id: 'a1' }, { stage_id: 'S1', membership_id: 'm2', athlete_id: 'b1' }],
  picks: [{ week_id: 'w1', membership_id: 'm1', athlete_id: 'a1' }],
  sessions: [{ id: 'p1', kind: 'tournament', held_on: '2026-10-24', counts: true, verified_at: '2026-10-24T20:00:00+00:00' }],
  lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 1 }, points_played: 7 }],
  injuries: [
    { athlete_id: 'b1', confirmed_at: '2026-10-10T00:00:00+00:00', cleared_at: '2026-10-12T00:00:00+00:00' },
    { athlete_id: 'b1', confirmed_at: null, cleared_at: null },
    { athlete_id: 'other-season', confirmed_at: '2026-10-10T00:00:00+00:00', cleared_at: null },
  ],
  athletes: [{ id: 'a1', name: 'Jordan' }, { id: 'b1', name: 'Sam' }],
};

describe('toYearInput', () => {
  it('maps snake_case rows to the core input, keeping confirmed injuries of this season only', () => {
    const input = toYearInput(rows, 123);
    expect(input.now).toBe(123);
    expect(input.weeks[0]).toEqual({ id: 'w1', stageId: 'S1', startsOn: '2026-10-19', endsOn: '2026-10-25',
      startsAt: '2026-10-19T04:00:00+00:00', endsAt: '2026-10-26T04:00:00+00:00', pickLockAt: '2026-10-20T01:00:00+00:00' });
    expect(input.sessions[0]).toEqual({ id: 'p1', kind: 'tournament', heldOn: '2026-10-24', counts: true, verifiedAt: '2026-10-24T20:00:00+00:00' });
    expect(input.statLines[0]).toEqual({ sessionId: 'p1', athleteId: 'a1', stats: { goal: 1 }, pointsPlayed: 7 });
    expect(input.injuries).toEqual([{ athleteId: 'b1', confirmedAt: '2026-10-10T00:00:00+00:00', clearedAt: '2026-10-12T00:00:00+00:00' }]);
    expect(input.picks).toEqual([{ weekId: 'w1', membershipId: 'm1', athleteId: 'a1' }]);
  });
});

describe('buildLeagueYear', () => {
  it('scores the year and carries names for the UI', () => {
    const y = buildLeagueYear(rows, Date.parse('2027-01-01T00:00:00Z'));
    expect(y.result.weeks[0].status).toBe('final');
    // Tournament ×2: goal 3 × 2 = 6. m2 never picked, so b1 was picked for them (and scored 0).
    const [m] = y.result.weeks[0].matchups;
    const m2 = m.home.membershipId === 'm2' ? m.home : m.away!;
    expect(m2).toMatchObject({ picked: null, athleteId: 'b1', notice: 'missed', score: 0 });
    expect(y.result.standings[0]).toMatchObject({ membershipId: 'm1', wins: 1, place: 1 });
    expect(y.team.get('m1')).toBe('Zeal');
    expect(y.athlete.get('b1')).toBe('Sam');
  });
});

describe('fetchAll', () => {
  it('keeps paging past the 1000-row cap so late-season stat lines are never dropped', async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => i);
    const asked: [number, number][] = [];
    const got = await fetchAll((from, to) => {
      asked.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    });
    expect(got).toEqual(rows);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('asks once more after an exactly full page, and throws on an error', async () => {
    let calls = 0;
    const got = await fetchAll((from) => { calls++; return Promise.resolve({ data: from === 0 ? Array(1000).fill(1) : [], error: null }); });
    expect([got.length, calls]).toEqual([1000, 2]);
    await expect(fetchAll(() => Promise.resolve({ data: null, error: new Error('boom') }))).rejects.toThrow('boom');
  });
});
