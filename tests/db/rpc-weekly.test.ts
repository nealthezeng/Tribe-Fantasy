import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, freshDb, migrationSql, rpc } from './helpers';
import { auctionFixture, inAnHour, member, type AuctionFixture } from './auction-fixture';
import { makeKeeper } from './stats-fixture';

let f: AuctionFixture;
let alice: string, aliceM: string, bob: string, bobM: string;

const createWeeks = (stage = f.stage) => as(f.db, f.admin, (tx) => rpc(tx, 'create_stage_weeks', { p_stage: stage }));
const weeks = async () => (await f.db.query<{ id: string; starts_on: string; ends_on: string; lock: string; ends: string }>(
  `select id, starts_on::text, ends_on::text, to_char(pick_lock_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as lock,
          to_char(ends_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as ends
   from public.weeks where stage_id = $1 order by starts_on`, [f.stage])).rows;
/** Superuser write: puts a week's lock `seconds` from now, so tests never depend on the calendar. */
const lockIn = (weekId: string, seconds: number) =>
  f.db.query(`update public.weeks set pick_lock_at = now() + make_interval(secs => $2) where id = $1`, [weekId, seconds]);
const setPick = (uid: string, mid: string, week: string, athlete: string | null) =>
  as(f.db, uid, (tx) => rpc(tx, 'set_pick', { p_membership: mid, p_week: week, p_athlete: athlete }));
const visiblePicks = (uid: string) =>
  as(f.db, uid, async (tx) => (await tx.query<{ membership_id: string }>('select membership_id from public.picks order by 1')).rows
    .map((r) => r.membership_id));

beforeEach(async () => {
  f = await auctionFixture(6);
  [alice, aliceM] = await member(f.db, 'alice');
  [bob, bobM] = await member(f.db, 'bob');
  // Rosters straight in (the auction itself is tested elsewhere): alice A0 A1, bob A2 A3.
  for (const [mid, a] of [[aliceM, 0], [aliceM, 1], [bobM, 2], [bobM, 3]] as const) {
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 0, 'fill')`, [f.stage, mid, f.league, f.athletes[a]]);
  }
});

describe('create_stage_weeks', () => {
  it('splits the stage into Mon–Sun weeks locking Monday 21:00 ET across the DST change', async () => {
    expect(await createWeeks()).toBe(4); // stage is Sun Oct 18 – Sun Nov 8
    expect(await weeks()).toEqual([
      // A week without a Monday locks at its start (00:00 EDT).
      expect.objectContaining({ starts_on: '2026-10-18', ends_on: '2026-10-18', lock: '2026-10-18T04:00Z', ends: '2026-10-19T04:00Z' }),
      expect.objectContaining({ starts_on: '2026-10-19', ends_on: '2026-10-25', lock: '2026-10-20T01:00Z' }),
      // Ends at midnight Nov 2 after DST ended on Nov 1: 05:00Z.
      expect.objectContaining({ starts_on: '2026-10-26', ends_on: '2026-11-01', lock: '2026-10-27T01:00Z', ends: '2026-11-02T05:00Z' }),
      expect.objectContaining({ starts_on: '2026-11-02', ends_on: '2026-11-08', lock: '2026-11-03T02:00Z' }),
    ]);
    const log = await f.db.query(`select 1 from public.audit_log where action = 'create_stage_weeks'`);
    expect(log.rows).toHaveLength(1);
  });

  it("uses the season's pick_lock_day and pick_lock_time", async () => {
    await as(f.db, f.admin, (tx) => rpc(tx, 'update_season_settings', {
      p_season: f.season, p_settings: { pick_lock_day: 'tue', pick_lock_time: '17:30' } }));
    await createWeeks();
    expect((await weeks()).map((w) => w.lock)).toEqual(
      ['2026-10-18T04:00Z', '2026-10-20T21:30Z', '2026-10-27T21:30Z', '2026-11-03T22:30Z']);
  });

  it('regenerates freely until a week has a pick, then refuses', async () => {
    await createWeeks();
    await createWeeks();
    const w = await weeks();
    expect(w).toHaveLength(4);
    await lockIn(w[1].id, 3600);
    await setPick(alice, aliceM, w[1].id, f.athletes[0]);
    await expect(createWeeks()).rejects.toThrow('WEEKS_HAVE_PICKS');
  });

  it('follows edited stage dates when rebuilt', async () => {
    await createWeeks();
    await as(f.db, f.admin, (tx) => rpc(tx, 'update_stage', {
      p_stage: f.stage, p_name: 'Fall beta', p_starts_on: '2026-10-19', p_ends_on: '2026-11-01', p_tournament: null }));
    await createWeeks();
    expect((await weeks()).map((w) => `${w.starts_on}..${w.ends_on}`)).toEqual(['2026-10-19..2026-10-25', '2026-10-26..2026-11-01']);
  });

  it('refuses an unknown stage', async () => {
    await expect(createWeeks(crypto.randomUUID())).rejects.toThrow('NOT_FOUND');
  });

  it('is admin-only', async () => {
    await expect(as(f.db, alice, (tx) => rpc(tx, 'create_stage_weeks', { p_stage: f.stage }))).rejects.toThrow('FORBIDDEN');
    await expect(as(f.db, alice, (tx) => rpc(tx, 'set_week_lock', { p_week: null, p_at: null }))).rejects.toThrow('FORBIDDEN');
  });
});

describe('set_week_lock', () => {
  it('moves one week and audits old and new', async () => {
    await createWeeks();
    const [, w1] = await weeks();
    // The fixture's week ends_at is a fixed 2026 date; push it (and the lock) off the real calendar so this test
    // doesn't rot once "now" catches up to that date (0009's set_week_lock now refuses p_at past the week's end).
    await f.db.query(`update public.weeks set pick_lock_at = now() + interval '1 hour', ends_at = now() + interval '1 day' where id = $1`, [w1.id]);
    const before = (await f.db.query<{ ms: number }>(
      'select extract(epoch from pick_lock_at) * 1000 as ms from public.weeks where id = $1', [w1.id])).rows[0].ms;
    const at = new Date(Date.now() + 7_200_000).toISOString();
    await as(f.db, f.admin, (tx) => rpc(tx, 'set_week_lock', { p_week: w1.id, p_at: at }));
    expect(Date.parse((await weeks())[1].lock)).toBe(Date.parse(at.slice(0, 16) + 'Z'));
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'set_week_lock', { p_week: w1.id, p_at: null }))).rejects.toThrow('INVALID_LOCK_TIME');
    const log = await f.db.query<{ details: { old: string; new: string } }>(`select details from public.audit_log where action = 'set_week_lock'`);
    expect(log.rows).toHaveLength(1);
    expect(Math.abs(Date.parse(log.rows[0].details.old) - Number(before))).toBeLessThan(1);
    expect(Date.parse(log.rows[0].details.new)).toBe(Date.parse(at));
  });

  it("won't move a lock that has passed (that would unseal picks and allow picking after the results)", async () => {
    await createWeeks();
    const [, w1] = await weeks();
    await lockIn(w1.id, -1);
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'set_week_lock', { p_week: w1.id, p_at: inAnHour() })))
      .rejects.toThrow('PICK_LOCKED');
  });

  it("won't move a lock past the week's own end (an admin who is also a manager could otherwise pick with hindsight, then move it back)", async () => {
    await createWeeks();
    const [, w1] = await weeks();
    await lockIn(w1.id, 3600); // lock hasn't passed
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'set_week_lock', { p_week: w1.id, p_at: '2099-01-01T00:00:00Z' })))
      .rejects.toThrow('INVALID_LOCK_TIME');
  });

  it('refuses an unknown week', async () => {
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'set_week_lock', { p_week: crypto.randomUUID(), p_at: inAnHour() })))
      .rejects.toThrow('NOT_FOUND');
  });
});

describe('set_pick', () => {
  let week: string;
  beforeEach(async () => {
    await createWeeks();
    week = (await weeks())[1].id;
    await lockIn(week, 3600);
  });

  it('saves, changes and clears your pick before the lock', async () => {
    await setPick(alice, aliceM, week, f.athletes[0]);
    await setPick(alice, aliceM, week, f.athletes[1]);
    const row = await f.db.query<{ athlete_id: string; league_id: string }>('select athlete_id, league_id from public.picks');
    expect(row.rows).toEqual([{ athlete_id: f.athletes[1], league_id: f.league }]);
    await setPick(alice, aliceM, week, null);
    expect((await f.db.query('select 1 from public.picks')).rows).toEqual([]);
  });

  it('refuses other teams, off-roster athletes, unknown weeks and locked weeks', async () => {
    await expect(setPick(alice, bobM, week, f.athletes[2])).rejects.toThrow('NOT_MEMBER');
    await expect(setPick(alice, aliceM, week, f.athletes[2])).rejects.toThrow('NOT_ON_ROSTER');
    await expect(setPick(alice, aliceM, crypto.randomUUID(), f.athletes[0])).rejects.toThrow('NOT_FOUND');
    await lockIn(week, -1);
    await expect(setPick(alice, aliceM, week, f.athletes[0])).rejects.toThrow('PICK_LOCKED');
    await expect(setPick(alice, aliceM, week, null)).rejects.toThrow('PICK_LOCKED');
  });

  it("refuses a week from another season's stage (the athlete isn't on that stage's roster)", async () => {
    const other = await as(f.db, f.admin, async (tx) => {
      const season = (await rpc(tx, 'create_season', { p_name: 'Next year', p_settings: {} })) as string;
      const stage = (await rpc(tx, 'create_stage', {
        p_season: season, p_name: 'Spring', p_starts_on: '2027-02-01', p_ends_on: '2027-02-21', p_tournament: null })) as string;
      await rpc(tx, 'create_stage_weeks', { p_stage: stage });
      return stage;
    });
    const w = (await f.db.query<{ id: string }>('select id from public.weeks where stage_id = $1 order by starts_on limit 1', [other])).rows[0].id;
    await lockIn(w, 3600);
    await expect(setPick(alice, aliceM, w, f.athletes[0])).rejects.toThrow('NOT_ON_ROSTER');
    expect((await f.db.query('select 1 from public.picks')).rows).toEqual([]);
  });

  it("doesn't check no-repeat or injuries (the scorer replaces those picks at the lock)", async () => {
    const other = (await weeks())[2].id;
    await lockIn(other, 3600);
    await setPick(alice, aliceM, week, f.athletes[0]);
    await setPick(alice, aliceM, other, f.athletes[0]);
    expect((await f.db.query('select 1 from public.picks')).rows).toHaveLength(2);
  });

  it('keeps picks sealed until the lock: own only, then the league and staff', async () => {
    const keeper = await createUser(f.db, 'keeper@x.test');
    await makeKeeper(f.db, keeper);
    const outsider = await createUser(f.db, 'out@x.test');
    await setPick(alice, aliceM, week, f.athletes[0]);
    await setPick(bob, bobM, week, f.athletes[2]);
    expect(await visiblePicks(alice)).toEqual([aliceM]);
    expect(await visiblePicks(keeper)).toEqual([]);
    await lockIn(week, -1);
    expect(await visiblePicks(alice)).toEqual([aliceM, bobM].sort());
    expect(await visiblePicks(keeper)).toHaveLength(2);
    expect(await visiblePicks(outsider)).toEqual([]);
    expect(await as(f.db, null, (tx) => tx.query('select 1 from public.picks')).catch((e: Error) => e.message))
      .toMatch(/permission denied/);
  });

  it("audits the membership but not the athlete", async () => {
    await setPick(alice, aliceM, week, f.athletes[0]);
    const log = await f.db.query<{ details: object }>(`select details from public.audit_log where action = 'set_pick'`);
    expect(log.rows).toEqual([{ details: { membership_id: aliceM } }]);
  });
});

describe('injuries for replaying past weeks', () => {
  it('lets the league read confirmed injuries after they clear, but never unconfirmed reports', async () => {
    const keeper = await createUser(f.db, 'keeper@x.test');
    await makeKeeper(f.db, keeper);
    await f.db.query(`insert into public.injuries (athlete_id, reported_by, confirmed_by, confirmed_at, cleared_at)
      values ($1, $3, $3, now() - interval '3 days', now() - interval '1 day'), ($2, $3, null, null, null)`,
    [f.athletes[0], f.athletes[1], keeper]);
    const seen = await as(f.db, bob, (tx) => tx.query<{ athlete_id: string }>('select athlete_id from public.injuries'));
    expect(seen.rows.map((r) => r.athlete_id)).toEqual([f.athletes[0]]);
  });
});

describe('0008 settings rewrite', () => {
  it('drops retired keys and old defaults the editor saved, and keeps values an admin chose', async () => {
    const db = await freshDb('0008');
    const old = { decay_grace_weeks: 2, decay_rate: 0.95, decay_floor: 0.5, upset_k: 1, decay_return_window: 4,
      trade_review_hours: 24, trade_keeps_usage: true, roster_size: 4 };
    await db.query(`insert into public.seasons (name, settings) values ('old', $1), ('tuned', $2)`,
      [JSON.stringify(old), JSON.stringify({ ...old, decay_rate: 0.8, upset_k: 1.5 })]);
    await db.exec(migrationSql('0008_weekly.sql'));
    const rows = (await db.query<{ name: string; settings: object }>('select name, settings from public.seasons order by name')).rows;
    expect(rows[0].settings).toEqual({ roster_size: 4 });
    expect(rows[1].settings).toEqual({ roster_size: 4, decay_rate: 0.8, upset_k: 1.5 });
  });
});
