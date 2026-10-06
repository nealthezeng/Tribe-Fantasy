// M5 gates from the M1+M2 reviews: with owns_athlete real, owners can't tally, verify, reopen, correct, confirm
// injuries or mark attendance for athletes on their own roster.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, rpc } from './helpers';
import { backdateVerify, statsFixture, tap, type StatsFixture } from './stats-fixture';

let f: StatsFixture;
let stage: string;

beforeEach(async () => {
  f = await statsFixture();
  stage = (await f.db.query<{ id: string }>(
    `insert into public.stages (season_id, name, starts_on, ends_on, bid_close_at, auction_seed, auction_run_at)
     values ($1, 'Fall beta', current_date - 3, current_date + 18, now(), 'seed', now()) returning id`, [f.season])).rows[0].id;
});

/** Superuser writes: `user` gets a team in the fixture's league with `athlete` on its roster in `inStage`. */
async function own(user: string, athlete: string, inStage = stage) {
  const mid = (await f.db.query<{ id: string }>(
    `insert into public.memberships (league_id, user_id, team_name) values ($1, $2, $3) returning id`,
    [f.league, user, `Team ${user.slice(0, 8)}`])).rows[0].id;
  await f.db.query(
    `insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
     values ($1, $2, $3, $4, 0, 'fill')`, [inStage, mid, f.league, athlete]);
}

/** Superuser write: an auctioned stage `fromDays`..`toDays` from today (negative = past). */
const stageAt = async (name: string, fromDays: number, toDays: number) => (await f.db.query<{ id: string }>(
  `insert into public.stages (season_id, name, starts_on, ends_on, bid_close_at, auction_seed, auction_run_at)
   values ($1, $2, current_date + $3::int, current_date + $4::int, now(), 'seed', now()) returning id`,
  [f.season, name, fromDays, toDays])).rows[0].id;

const now = () => new Date().toISOString();
const save = (keeper: string, athlete: string) =>
  as(f.db, keeper, (tx) => rpc(tx, 'save_taps', { p_session: f.session, p_client_now: now(), p_taps: [tap(athlete, 'goal', now())] }));
const verify = (keeper: string, athlete: string) =>
  as(f.db, keeper, (tx) => rpc(tx, 'verify_session', { p_session: f.session, p_lines: [{ athlete_id: athlete, stats: { goal: 1 } }] }));

describe('owner gates', () => {
  it('save_taps refuses a tap on your own athlete', async () => {
    await own(f.k1, f.sam);
    await expect(save(f.k1, f.sam)).rejects.toThrow('OWNS_ATHLETE');
    await save(f.k1, f.ali);
  });

  it('save_taps drops the whole batch when one tap is on your athlete (the tally screen greys them out)', async () => {
    await own(f.k1, f.sam);
    const taps = [tap(f.ali, 'goal', now()), tap(f.sam, 'goal', now())];
    await expect(as(f.db, f.k1, (tx) => rpc(tx, 'save_taps', { p_session: f.session, p_client_now: now(), p_taps: taps })))
      .rejects.toThrow('OWNS_ATHLETE');
    expect((await f.db.query(`select 1 from public.stat_taps`)).rows).toHaveLength(0);
  });

  it('verify_session refuses when the session has taps on your athlete', async () => {
    await own(f.k1, f.sam);
    await save(f.k2, f.sam);
    await expect(verify(f.k1, f.sam)).rejects.toThrow('OWNS_ATHLETE');
    await verify(f.k3, f.sam);
  });

  it('reopen_session refuses an owner, so they cannot keep a session from locking', async () => {
    await own(f.k1, f.sam);
    await save(f.k2, f.sam);
    await verify(f.k3, f.sam);
    await expect(as(f.db, f.k1, (tx) => rpc(tx, 'reopen_session', { p_session: f.session }))).rejects.toThrow('OWNS_ATHLETE');
    await as(f.db, f.k2, (tx) => rpc(tx, 'reopen_session', { p_session: f.session }));
  });

  it('an admin is never an owner: tallies, verifies their own tally, reopens and corrects their own athlete (t120)', async () => {
    await own(f.admin, f.sam);
    await save(f.admin, f.sam);
    await verify(f.admin, f.sam); // no OWNS_ATHLETE, no VERIFIER_TAPPED
    await as(f.db, f.admin, (tx) => rpc(tx, 'reopen_session', { p_session: f.session }));
    await verify(f.admin, f.sam);
    await backdateVerify(f.db, f.session, 49);
    await as(f.db, f.admin, (tx) => rpc(tx, 'correct_stat_line', { p_session: f.session, p_athlete: f.sam, p_stats: { goal: 2 } }));
    const iid = (await as(f.db, f.admin, (tx) => rpc(tx, 'report_injury', { p_athlete: f.sam }))) as string;
    const row = await f.db.query<{ confirmed_at: string | null }>(`select confirmed_at from public.injuries where id = $1`, [iid]);
    expect(row.rows[0].confirmed_at).not.toBeNull(); // auto-confirmed, as for any non-owner keeper
  });

  it('a keeper who tallied still cannot verify (VERIFIER_TAPPED is lifted for admins only)', async () => {
    await save(f.k1, f.sam);
    await expect(verify(f.k1, f.sam)).rejects.toThrow('VERIFIER_TAPPED');
  });

  it('set_attendance refuses a keeper who owns the athlete, but not a player marking themselves', async () => {
    await own(f.k1, f.sam);
    const mark = (athlete: string) =>
      as(f.db, f.k1, (tx) => rpc(tx, 'set_attendance', { p_session: f.session, p_athlete: athlete, p_status: 'present' }));
    await expect(mark(f.sam)).rejects.toThrow('OWNS_ATHLETE');
    await mark(f.ali);
    await f.db.query(`update public.athletes set user_id = $1 where id = $2`, [f.k1, f.sam]); // k1 is Sam
    await mark(f.sam);
  });

  it("still counts last stage's owner while its closing tournament is verified after the next auction", async () => {
    const ended = await stageAt('Just ended', -20, -2);
    await stageAt('Next', -1, 20);
    await own(f.k1, f.sam, ended);
    await expect(save(f.k1, f.sam)).rejects.toThrow('OWNS_ATHLETE');
  });

  it('forgets owners of a stage that ended over a week ago', async () => {
    const old = await stageAt('Long over', -30, -10);
    await own(f.k1, f.sam, old);
    await save(f.k1, f.sam);
  });

  it('a keeper who is the injured player can report but not confirm their own injury', async () => {
    await f.db.query(`update public.athletes set user_id = $1 where id = $2`, [f.k1, f.sam]); // k1 is Sam
    const iid = (await as(f.db, f.k1, (tx) => rpc(tx, 'report_injury', { p_athlete: f.sam }))) as string;
    const row = await f.db.query<{ confirmed_at: string | null }>(`select confirmed_at from public.injuries where id = $1`, [iid]);
    expect(row.rows[0].confirmed_at).toBeNull();
    await expect(as(f.db, f.k1, (tx) => rpc(tx, 'confirm_injury', { p_injury: iid }))).rejects.toThrow('OWNS_ATHLETE');
  });

  it('confirm_injury refuses an owner, and report_injury by an owner is not auto-confirmed', async () => {
    await own(f.k1, f.sam);
    const iid = (await as(f.db, f.k1, (tx) => rpc(tx, 'report_injury', { p_athlete: f.sam }))) as string;
    const row = await f.db.query<{ confirmed_at: string | null }>(`select confirmed_at from public.injuries where id = $1`, [iid]);
    expect(row.rows[0].confirmed_at).toBeNull();
    await expect(as(f.db, f.k1, (tx) => rpc(tx, 'confirm_injury', { p_injury: iid }))).rejects.toThrow('OWNS_ATHLETE');
    await as(f.db, f.k2, (tx) => rpc(tx, 'confirm_injury', { p_injury: iid }));
    const other = (await as(f.db, f.k2, (tx) => rpc(tx, 'report_injury', { p_athlete: f.ali }))) as string;
    const auto = await f.db.query<{ confirmed_at: string | null }>(`select confirmed_at from public.injuries where id = $1`, [other]);
    expect(auto.rows[0].confirmed_at).not.toBeNull();
  });
});
