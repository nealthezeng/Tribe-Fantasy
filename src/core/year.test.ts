import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { scoreYear, type YearInput, type YearSession, type YearStatLine, type YearWeek } from './year';

const s = parseSettings({ upset_k: 1 });
const NOW = Date.parse('2027-01-01T00:00:00Z');

/** Mon–Sun weeks; lock Monday 21:00 EDT (01:00Z Tuesday). */
const week = (id: string, stageId: string, monday: string): YearWeek => {
  const start = Date.parse(`${monday}T04:00:00Z`);
  const day = (n: number) => new Date(start + n * 86_400_000).toISOString();
  return {
    id, stageId, startsOn: monday, endsOn: day(6).slice(0, 10), startsAt: day(0), endsAt: day(7),
    pickLockAt: new Date(start + 21 * 3_600_000).toISOString(),
  };
};
const W1 = week('w1', 'S1', '2026-10-19');
const W2 = week('w2', 'S1', '2026-10-26');
const W3 = week('w3', 'S1', '2026-11-02');
const W4 = week('w4', 'S2', '2026-11-09');

/** A counted practice on the Tuesday of `w`, verified that day (so locked 48 h later). */
const practice = (id: string, w: YearWeek, verified = true): YearSession => {
  const tue = new Date(Date.parse(w.startsAt) + 86_400_000).toISOString();
  return { id, kind: 'practice', heldOn: tue.slice(0, 10), counts: true, verifiedAt: verified ? tue : null };
};
const line = (sessionId: string, athleteId: string, goals: number): YearStatLine =>
  ({ sessionId, athleteId, stats: { goal: goals }, pointsPlayed: 10 });

const base = (over: Partial<YearInput> = {}): YearInput => ({
  settings: s,
  now: NOW,
  weeks: [W1, W2, W3, W4],
  members: [{ id: 'm1', createdAt: '2026-10-01T00:00:00Z' }, { id: 'm2', createdAt: '2026-10-01T00:00:00Z' }],
  slots: [
    ...['a1', 'a2', 'a3'].map((athleteId) => ({ stageId: 'S1', membershipId: 'm1', athleteId })),
    ...['b1', 'b2', 'b3'].map((athleteId) => ({ stageId: 'S1', membershipId: 'm2', athleteId })),
    ...['a1', 'a2'].map((athleteId) => ({ stageId: 'S2', membershipId: 'm1', athleteId })),
    ...['b1', 'b2'].map((athleteId) => ({ stageId: 'S2', membershipId: 'm2', athleteId })),
  ],
  picks: [
    { weekId: 'w1', membershipId: 'm1', athleteId: 'a1' }, { weekId: 'w1', membershipId: 'm2', athleteId: 'b1' },
    { weekId: 'w2', membershipId: 'm1', athleteId: 'a2' }, { weekId: 'w2', membershipId: 'm2', athleteId: 'b2' },
    { weekId: 'w3', membershipId: 'm1', athleteId: 'a3' }, { weekId: 'w3', membershipId: 'm2', athleteId: 'b3' },
    { weekId: 'w4', membershipId: 'm1', athleteId: 'a1' }, { weekId: 'w4', membershipId: 'm2', athleteId: 'b1' },
  ],
  sessions: [practice('p1', W1), practice('p2', W2), practice('p3', W3), practice('p4', W4)],
  statLines: [
    line('p1', 'a1', 3), line('p1', 'b1', 1), line('p1', 'a2', 5),
    line('p2', 'a2', 1), line('p2', 'b2', 2),
    line('p3', 'a3', 2), line('p3', 'b3', 2),
    line('p4', 'a1', 1), line('p4', 'b1', 4),
  ],
  injuries: [],
  ...over,
});
const side = (r: ReturnType<typeof scoreYear>, weekId: string, m: string) => {
  const mt = r.weeks.find((w) => w.week.id === weekId)!.matchups.find((x) => x.home.membershipId === m || x.away?.membershipId === m)!;
  return mt.home.membershipId === m ? mt.home : mt.away!;
};

describe('scoreYear', () => {
  it('scores final weeks in order and keeps a W-L-T table', () => {
    const r = scoreYear(base());
    expect(r.weeks.map((w) => w.status)).toEqual(['final', 'final', 'final', 'final']);
    expect(side(r, 'w1', 'm1')).toMatchObject({ athleteId: 'a1', notice: null, score: 9, delta: 3, result: 'W' });
    expect(side(r, 'w1', 'm2')).toMatchObject({ athleteId: 'b1', score: 3, delta: -1, result: 'L' });
    expect(side(r, 'w3', 'm1')).toMatchObject({ result: 'T', delta: 1 });
    const m1 = r.standings.find((x) => x.membershipId === 'm1')!;
    expect(m1).toMatchObject({ wins: 1, losses: 2, ties: 1 });
    expect(m1.points).toBeCloseTo(r.weeks.reduce((sum, w) => sum + (side(r, w.week.id, 'm1').delta ?? 0), 0));
  });

  it('rank-weights from the standings after the previous final week', () => {
    // After w1 m1 leads, so m2 winning w2 is an upset: 3 × (1 + 1 × (2 − 1) / 1) = 6.
    expect(side(scoreYear(base()), 'w2', 'm2').delta).toBeCloseTo(6);
  });

  it('fills a missed pick with the best unused athlete by recent average', () => {
    const r = scoreYear(base({ picks: base().picks.filter((p) => !(p.weekId === 'w2' && p.membershipId === 'm1')) }));
    // a2 scored 15 in w1 (a3 had no line: absent_score 0), so a2 beats a3.
    expect(side(r, 'w2', 'm1')).toMatchObject({ picked: null, athleteId: 'a2', notice: 'missed' });
  });

  it('replaces a pick already used this cycle', () => {
    const picks = base().picks.map((p) => (p.weekId === 'w2' && p.membershipId === 'm1' ? { ...p, athleteId: 'a1' } : p));
    expect(side(scoreYear(base({ picks })), 'w2', 'm1')).toMatchObject({ picked: 'a1', athleteId: 'a2', notice: 'used' });
  });

  it('replaces a pick that is not on the roster (only possible through the API)', () => {
    const picks = base().picks.map((p) => (p.weekId === 'w1' && p.membershipId === 'm1' ? { ...p, athleteId: 'b1' } : p));
    expect(side(scoreYear(base({ picks })), 'w1', 'm1')).toMatchObject({ athleteId: 'a1', notice: 'used' });
  });

  it('swaps an athlete injured at the lock for a healthy one, and says so', () => {
    const injuries = [{ athleteId: 'a1', confirmedAt: '2026-10-19T12:00:00Z', clearedAt: null }];
    const r = scoreYear(base({ injuries }));
    // Healthy unused a2, a3; no history yet → lowest id.
    expect(side(r, 'w1', 'm1')).toMatchObject({ picked: 'a1', athleteId: 'a2', notice: 'injured' });
  });

  it('keeps the pick when the injury is confirmed after the lock', () => {
    const injuries = [{ athleteId: 'a1', confirmedAt: '2026-10-21T12:00:00Z', clearedAt: null }];
    expect(side(scoreYear(base({ injuries })), 'w1', 'm1')).toMatchObject({ athleteId: 'a1', notice: null });
  });

  it("doesn't use up an athlete injured that week with no counted stat line", () => {
    // a3 is picked in w1, gets hurt after the lock and doesn't play; it's then free again in w2.
    const injuries = [{ athleteId: 'a3', confirmedAt: '2026-10-21T12:00:00Z', clearedAt: '2026-10-24T00:00:00Z' }];
    const picks = base().picks.map((p) => {
      if (p.membershipId !== 'm1') return p;
      if (p.weekId === 'w1') return { ...p, athleteId: 'a3' };
      if (p.weekId === 'w2') return { ...p, athleteId: 'a3' };
      return p;
    });
    const r = scoreYear(base({ injuries, picks }));
    expect(side(r, 'w1', 'm1')).toMatchObject({ athleteId: 'a3', score: 0 });
    expect(side(r, 'w2', 'm1')).toMatchObject({ athleteId: 'a3', notice: null });
  });

  it('skips a week with no counted session: no matchup result and nobody used up', () => {
    const picks = base().picks.map((p) => (p.weekId === 'w2' && p.membershipId === 'm1' ? { ...p, athleteId: 'a1' } : p));
    const r = scoreYear(base({ sessions: base().sessions.filter((x) => x.id !== 'p1'), picks }));
    expect(r.weeks[0].status).toBe('skipped');
    expect(side(r, 'w1', 'm1').delta).toBeNull();
    expect(side(r, 'w2', 'm1')).toMatchObject({ athleteId: 'a1', notice: null });
  });

  it('ignores sessions that do not count', () => {
    const sessions = base().sessions.map((x) => (x.id === 'p1' ? { ...x, counts: false } : x));
    expect(scoreYear(base({ sessions })).weeks[0].status).toBe('skipped');
  });

  it('holds back every later week while an earlier one is pending (e.g. after a reopen)', () => {
    const sessions = base().sessions.map((x) => (x.id === 'p1' ? { ...x, verifiedAt: null } : x));
    const r = scoreYear(base({ sessions }));
    expect(r.weeks.map((w) => w.status)).toEqual(['pending', 'pending', 'pending', 'pending']);
    expect(r.standings.every((x) => x.points === 0)).toBe(true);
    // Still pending until 48 h after verification.
    const late = base().sessions.map((x) => (x.id === 'p4' ? { ...x, verifiedAt: '2026-12-31T12:00:00Z' } : x));
    expect(scoreYear(base({ sessions: late })).weeks[3].status).toBe('pending');
  });

  it('reports open and locked weeks without scores', () => {
    const r = scoreYear(base({ now: Date.parse('2026-10-20T00:00:00Z') }));
    expect(r.weeks.map((w) => w.status)).toEqual(['open', 'open', 'open', 'open']);
    const locked = scoreYear(base({ now: Date.parse('2026-10-21T00:00:00Z') }));
    expect(locked.weeks[0].status).toBe('locked');
    expect(side(locked, 'w1', 'm1')).toMatchObject({ athleteId: 'a1', score: null });
  });

  it('previews the swap for an open week using injuries as of now', () => {
    const injuries = [{ athleteId: 'a1', confirmedAt: '2026-10-19T12:00:00Z', clearedAt: null }];
    const r = scoreYear(base({ now: Date.parse('2026-10-19T20:00:00Z'), injuries }));
    expect(side(r, 'w1', 'm1')).toMatchObject({ picked: 'a1', athleteId: 'a2', notice: 'injured' });
  });

  it('counts a locked week as used when previewing the next open week', () => {
    const picks = base().picks.map((p) => (p.weekId === 'w2' && p.membershipId === 'm1' ? { ...p, athleteId: 'a1' } : p));
    const r = scoreYear(base({ now: Date.parse('2026-10-22T00:00:00Z'), picks }));
    expect(side(r, 'w2', 'm1')).toMatchObject({ athleteId: 'a2', notice: 'used', available: ['a2', 'a3'] });
  });

  it('starts a new cycle once the whole roster is used', () => {
    const slots = base().slots.filter((x) => !(x.stageId === 'S1' && x.athleteId === 'a3'));
    const picks = base().picks.map((p) => (p.weekId === 'w3' && p.membershipId === 'm1' ? { ...p, athleteId: 'a1' } : p));
    expect(side(scoreYear(base({ slots, picks })), 'w3', 'm1')).toMatchObject({ athleteId: 'a1', notice: null });
  });

  it('resets usage each stage and degrades by earlier stages started, not weeks', () => {
    const r = scoreYear(base({ settings: parseSettings({ upset_k: 1, decay_grace_stages: 0 }) }));
    // a1 was used in S1; in S2 it's pickable again, at 0.9^1.
    expect(side(r, 'w4', 'm1')).toMatchObject({ athleteId: 'a1', notice: null });
    expect(side(r, 'w4', 'm1').multiplier).toBeCloseTo(0.9);
    // Within its first stage, no decay however many weeks pass.
    expect(side(r, 'w3', 'm1').multiplier).toBe(1);
    // Default grace of 1 stage: still 1 in the second stage.
    expect(side(scoreYear(base()), 'w4', 'm1').multiplier).toBe(1);
  });

  it('forfeits when the roster is empty (joined after the auction)', () => {
    const slots = base().slots.filter((x) => !(x.stageId === 'S1' && x.membershipId === 'm2'));
    expect(side(scoreYear(base({ slots })), 'w1', 'm2')).toMatchObject({ athleteId: null, score: 0, result: 'L' });
  });

  it('schedules only members who joined by the lock, gives byes, and keeps the rotation across stages', () => {
    const members = [...base().members, { id: 'm3', createdAt: '2026-10-22T00:00:00Z' }];
    const r = scoreYear(base({ members }));
    expect(r.weeks[0].matchups).toHaveLength(1);
    expect(r.weeks[1].matchups).toHaveLength(2);
    expect(r.weeks[1].matchups.some((m) => m.away === null)).toBe(true);
    expect(r.standings.map((x) => x.membershipId).sort()).toEqual(['m1', 'm2', 'm3']);
    const pairs = r.weeks.slice(1).map((w) => w.matchups.find((m) => m.away)!.home.membershipId + w.matchups.find((m) => m.away)!.away!.membershipId);
    expect(new Set(pairs).size).toBe(3);
  });

  it('ranks with shared average ranks and display places', () => {
    const r = scoreYear(base({ now: Date.parse('2026-10-01T00:00:00Z') }));
    expect(r.standings.map((x) => [x.rank, x.place, x.tied])).toEqual([[1.5, 1, true], [1.5, 1, true]]);
  });

  it('is deterministic whatever order the rows arrive in', () => {
    const b = base();
    const shuffled = base({ weeks: [...b.weeks].reverse(), slots: [...b.slots].reverse(), picks: [...b.picks].reverse() });
    expect(scoreYear(shuffled).standings).toEqual(scoreYear(b).standings);
  });
});
