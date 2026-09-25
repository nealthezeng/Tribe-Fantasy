import { beforeEach, describe, expect, it } from 'vitest';
import { as, rpc } from './helpers';
import { backdateVerify, statsFixture, tap, type StatsFixture } from './stats-fixture';

let f: StatsFixture;
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const save = (who: string, taps: object[], clientNow = iso()) =>
  as(f.db, who, (tx) => rpc(tx, 'save_taps', { p_session: f.session, p_client_now: clientNow, p_taps: taps }));
const verify = (who: string, lines: object[]) =>
  as(f.db, who, (tx) => rpc(tx, 'verify_session', { p_session: f.session, p_lines: lines }));
const audits = async (action: string) =>
  (await f.db.query<{ n: number }>(`select count(*)::int as n from public.audit_log where action = $1`, [action])).rows[0].n;

beforeEach(async () => {
  f = await statsFixture();
});

describe('create_session', () => {
  it('lets keepers create sessions and audits it', async () => {
    expect(await audits('create_session')).toBe(1);
    const row = await f.db.query(`select kind, counts, created_by from public.sessions where id = $1`, [f.session]);
    expect(row.rows).toEqual([{ kind: 'practice', counts: true, created_by: f.k1 }]);
  });

  it('rejects bad input and non-keepers', async () => {
    const make = (who: string, kind: string) =>
      as(f.db, who, (tx) => rpc(tx, 'create_session', { p_season: f.season, p_kind: kind, p_held_on: '2026-11-16', p_counts: true }));
    await expect(make(f.k1, 'scrimmage')).rejects.toThrow('INVALID_SESSION');
    await expect(make(f.member, 'practice')).rejects.toThrow('FORBIDDEN');
  });
});

describe('save_taps', () => {
  it('stores taps, marks the athlete present and returns how many were new', async () => {
    expect(await save(f.k1, [tap(f.sam, 'goal', iso()), tap(f.sam, 'assist', iso())])).toBe(2);
    const att = await f.db.query(`select athlete_id, status from public.attendance`);
    expect(att.rows).toEqual([{ athlete_id: f.sam, status: 'present' }]);
    expect(await audits('save_taps')).toBe(1);
  });

  it('ignores a re-sent batch (autosave retry after a timeout)', async () => {
    const batch = [tap(f.sam, 'goal', iso())];
    expect(await save(f.k1, batch)).toBe(1);
    expect(await save(f.k1, batch)).toBe(0);
    const n = await f.db.query<{ n: number }>(`select count(*)::int as n from public.stat_taps`);
    expect(n.rows[0].n).toBe(1);
  });

  it('corrects a phone clock that runs 5 minutes slow', async () => {
    const phoneNow = iso(5 * 60_000);
    const tappedOnPhone = new Date(Date.parse(phoneNow) - 10_000).toISOString();
    await save(f.k1, [tap(f.sam, 'goal', tappedOnPhone)], phoneNow);
    const row = await f.db.query<{ lag: number }>(
      `select extract(epoch from now() - tapped_at)::float as lag from public.stat_taps`,
    );
    expect(row.rows[0].lag).toBeGreaterThan(5);
    expect(row.rows[0].lag).toBeLessThan(20);
  });

  it('only accepts stats from the season stat_weights', async () => {
    await expect(save(f.k1, [tap(f.sam, 'completion', iso())])).rejects.toThrow('UNKNOWN_STAT');
    await as(f.db, f.admin, (tx) =>
      rpc(tx, 'update_season_settings', { p_season: f.season, p_settings: { stat_weights: { goal: 1 } } }),
    );
    await expect(save(f.k1, [tap(f.sam, 'assist', iso())])).rejects.toThrow('UNKNOWN_STAT');
  });

  it('accepts an undo of your own tap in the same batch, never of someone else’s, and only once', async () => {
    const mine = tap(f.sam, 'goal', iso());
    expect(await save(f.k1, [mine, tap(f.sam, 'goal', iso(), mine.id)])).toBe(2);
    const theirs = tap(f.sam, 'goal', iso());
    await save(f.k2, [theirs]);
    await expect(save(f.k1, [tap(f.sam, 'goal', iso(), theirs.id)])).rejects.toThrow('INVALID_TAPS');
    await expect(save(f.k1, [tap(f.sam, 'goal', iso(), mine.id)])).rejects.toThrow('INVALID_TAPS');
  });

  it('rejects malformed batches and athletes from another season', async () => {
    await expect(save(f.k1, [{ ...tap(f.sam, 'goal', iso()), id: 'nope' }])).rejects.toThrow('INVALID_TAPS');
    await expect(
      as(f.db, f.k1, (tx) => rpc(tx, 'save_taps', { p_session: f.session, p_client_now: iso(), p_taps: { a: 1 } })),
    ).rejects.toThrow('INVALID_TAPS');
    await expect(save(f.k1, [tap(crypto.randomUUID(), 'goal', iso())])).rejects.toThrow('NOT_FOUND');
  });

  it('rejects taps once the session is verified', async () => {
    await verify(f.k2, []);
    await expect(save(f.k1, [tap(f.sam, 'goal', iso())])).rejects.toThrow('SESSION_VERIFIED');
  });

  it('is keeper-only', async () => {
    await expect(save(f.member, [tap(f.sam, 'goal', iso())])).rejects.toThrow('FORBIDDEN');
  });
});

describe('verify_session', () => {
  beforeEach(async () => {
    // Two keepers tap the same goal 2s apart; k1 also taps an assist and undoes a mis-tap.
    const t0 = Date.now() - 60_000;
    const at = (s: number) => new Date(t0 + s * 1000).toISOString();
    const misTap = tap(f.ali, 'goal', at(5));
    await save(f.k1, [tap(f.sam, 'goal', at(0)), tap(f.sam, 'assist', at(1)), misTap, tap(f.ali, 'goal', at(6), misTap.id)]);
    await save(f.k2, [tap(f.sam, 'goal', at(2))]);
  });

  it('writes stat lines, marks the session verified and audits the lines', async () => {
    const lines = [{ athlete_id: f.sam, stats: { goal: 1, assist: 1 } }];
    await verify(f.k3, lines);
    const rows = await f.db.query(`select athlete_id, stats, points_played from public.stat_lines`);
    expect(rows.rows).toEqual([{ athlete_id: f.sam, stats: { goal: 1, assist: 1 }, points_played: 0 }]);
    const s = await f.db.query(`select verified_by from public.sessions where id = $1`, [f.session]);
    expect(s.rows).toEqual([{ verified_by: f.k3 }]);
    const log = await f.db.query<{ details: unknown }>(`select details from public.audit_log where action = 'verify_session'`);
    expect(log.rows[0].details).toEqual({ lines });
  });

  it('accepts any count between the biggest keeper and the keeper sum', async () => {
    await verify(f.k3, [{ athlete_id: f.sam, stats: { goal: 2, assist: 1 } }]);
  });

  it('rejects counts outside the tap bounds (LINES_MISMATCH)', async () => {
    const bad = [
      [{ athlete_id: f.sam, stats: { goal: 3, assist: 1 } }], // more than all keepers tapped
      [{ athlete_id: f.sam, stats: { goal: 0, assist: 1 } }], // fewer than one keeper tapped
      [{ athlete_id: f.sam, stats: { goal: 1 } }], // assist left out
      [], // athlete left out
      [{ athlete_id: f.sam, stats: { goal: 1, assist: 1 } }, { athlete_id: f.ali, stats: { goal: 1 } }], // undone tap counted
    ];
    for (const lines of bad) await expect(verify(f.k3, lines)).rejects.toThrow('LINES_MISMATCH');
  });

  it('rejects malformed lines', async () => {
    await expect(verify(f.k3, [{ athlete_id: f.sam, stats: { goal: -1 } }])).rejects.toThrow('INVALID_LINES');
    await expect(verify(f.k3, [{ athlete_id: f.sam, stats: { goal: 1.5 } }])).rejects.toThrow('INVALID_LINES');
    await expect(verify(f.k3, [{ athlete_id: f.sam, stats: { layout: 1 } }])).rejects.toThrow('UNKNOWN_STAT');
    const dup = { athlete_id: f.sam, stats: { goal: 1, assist: 1 } };
    await expect(verify(f.k3, [dup, dup])).rejects.toThrow('INVALID_LINES');
    await expect(verify(f.k3, [{ athlete_id: crypto.randomUUID(), stats: {} }])).rejects.toThrow('NOT_FOUND');
  });

  it('refuses a verifier who tapped in the session, a second verify, and non-keepers', async () => {
    const lines = [{ athlete_id: f.sam, stats: { goal: 1, assist: 1 } }];
    await expect(verify(f.k1, lines)).rejects.toThrow('VERIFIER_TAPPED');
    await expect(verify(f.member, lines)).rejects.toThrow('FORBIDDEN');
    await verify(f.k3, lines);
    await expect(verify(f.admin, lines)).rejects.toThrow('SESSION_VERIFIED');
  });
});

describe('reopen_session and correct_stat_line', () => {
  const lines = () => [{ athlete_id: f.sam, stats: { goal: 1 } }];
  const reopen = (who: string) => as(f.db, who, (tx) => rpc(tx, 'reopen_session', { p_session: f.session }));
  const correct = (who: string, stats: object) =>
    as(f.db, who, (tx) => rpc(tx, 'correct_stat_line', { p_session: f.session, p_athlete: f.sam, p_stats: stats }));

  beforeEach(async () => {
    await save(f.k1, [tap(f.sam, 'goal', iso())]);
    await verify(f.k2, lines());
  });

  it('reopens before the lock, deleting the lines', async () => {
    await reopen(f.k3);
    const n = await f.db.query<{ n: number }>(`select count(*)::int as n from public.stat_lines`);
    expect(n.rows[0].n).toBe(0);
    const s = await f.db.query(`select verified_at from public.sessions where id = $1`, [f.session]);
    expect(s.rows).toEqual([{ verified_at: null }]);
    await expect(reopen(f.k3)).rejects.toThrow('SESSION_NOT_VERIFIED');
  });

  it('locks stat_lock_hours after verify: no reopen, admin-only corrections flagged for rescore', async () => {
    await expect(correct(f.admin, { goal: 2 })).rejects.toThrow('SESSION_NOT_LOCKED');
    await backdateVerify(f.db, f.session, 49);
    await expect(reopen(f.k3)).rejects.toThrow('SESSION_LOCKED');
    await expect(correct(f.k3, { goal: 2 })).rejects.toThrow('FORBIDDEN');
    await correct(f.admin, { goal: 2 });
    const row = await f.db.query(`select stats from public.stat_lines where athlete_id = $1`, [f.sam]);
    expect(row.rows).toEqual([{ stats: { goal: 2 } }]);
    const log = await f.db.query<{ details: unknown }>(`select details from public.audit_log where action = 'correct_stat_line'`);
    expect(log.rows[0].details).toEqual({ athlete_id: f.sam, old: { goal: 1 }, new: { goal: 2 }, rescore_needed: true });
  });

  it('reads the lock length from season settings', async () => {
    await as(f.db, f.admin, (tx) =>
      rpc(tx, 'update_season_settings', { p_season: f.season, p_settings: { stat_lock_hours: 1 } }),
    );
    await backdateVerify(f.db, f.session, 2);
    await expect(reopen(f.k3)).rejects.toThrow('SESSION_LOCKED');
  });
});
