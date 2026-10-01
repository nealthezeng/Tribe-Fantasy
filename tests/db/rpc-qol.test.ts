import { describe, expect, it } from 'vitest';
import { as, rpc } from './helpers';
import { auctionFixture, bid, grant, member, openAuction } from './auction-fixture';
import { backdateVerify, statsFixture, tap } from './stats-fixture';

const audit = async (db: Awaited<ReturnType<typeof statsFixture>>['db'], action: string) =>
  (await db.query<{ details: Record<string, unknown> }>(`select details from public.audit_log where action = $1`, [action])).rows;

describe('rename_athlete', () => {
  it('renames and audits old and new names', async () => {
    const f = await statsFixture();
    await as(f.db, f.admin, (tx) => rpc(tx, 'rename_athlete', { p_athlete: f.sam, p_name: '  Samantha ' }));
    const row = await f.db.query<{ name: string }>(`select name from public.athletes where id = $1`, [f.sam]);
    expect(row.rows[0].name).toBe('Samantha');
    expect((await audit(f.db, 'rename_athlete'))[0].details).toEqual({ old: 'Sam', new: 'Samantha' });
  });

  it('refuses a name already used this season, and a missing athlete', async () => {
    const f = await statsFixture();
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'rename_athlete', { p_athlete: f.sam, p_name: 'Ali' })))
      .rejects.toThrow('ATHLETE_EXISTS');
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'rename_athlete', { p_athlete: crypto.randomUUID(), p_name: 'X' })))
      .rejects.toThrow('NOT_FOUND');
  });
});

describe('delete_athlete', () => {
  it('deletes an athlete with no history and audits it', async () => {
    const f = await statsFixture();
    await as(f.db, f.admin, (tx) => rpc(tx, 'delete_athlete', { p_athlete: f.ali }));
    expect((await f.db.query(`select 1 from public.athletes where id = $1`, [f.ali])).rows).toHaveLength(0);
    expect((await audit(f.db, 'delete_athlete'))[0].details).toMatchObject({ name: 'Ali', season_id: f.season });
  });

  it('refuses an athlete with a tap, and a missing athlete', async () => {
    const f = await statsFixture();
    const now = new Date().toISOString();
    await as(f.db, f.k1, (tx) =>
      rpc(tx, 'save_taps', { p_session: f.session, p_client_now: now, p_taps: [tap(f.sam, 'goal', now)] }));
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'delete_athlete', { p_athlete: f.sam }))).rejects.toThrow('ATHLETE_IN_USE');
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'delete_athlete', { p_athlete: crypto.randomUUID() })))
      .rejects.toThrow('NOT_FOUND');
  });

  it('refuses an athlete with a bid, a roster slot or a pick', async () => {
    const f = await auctionFixture();
    const [alice, am] = await member(f.db, 'alice');
    await grant(f);
    await openAuction(f);
    const [a0, a1, a2] = f.athletes;
    await bid(f, alice, am, a0, 5);
    // Superuser writes: a roster slot and a pick, without running the auction or building weeks.
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 0, 'fill')`, [f.stage, am, f.league, a1]);
    const week = (await f.db.query<{ id: string }>(`insert into public.weeks (stage_id, starts_on, ends_on, starts_at, ends_at, pick_lock_at)
      values ($1, '2026-10-19', '2026-10-25', '2026-10-19', '2026-10-26', '2026-10-20') returning id`, [f.stage])).rows[0].id;
    await f.db.query(`insert into public.picks (week_id, membership_id, league_id, athlete_id) values ($1, $2, $3, $4)`,
      [week, am, f.league, a2]);
    for (const a of [a0, a1, a2]) {
      await expect(as(f.db, f.admin, (tx) => rpc(tx, 'delete_athlete', { p_athlete: a }))).rejects.toThrow('ATHLETE_IN_USE');
    }
  });
});

describe('delete_athlete forced (t81)', () => {
  it('wipes all history, refunds only priced roster slots, and audits the counts', async () => {
    const f = await auctionFixture();
    const [alice, am] = await member(f.db, 'alice');
    const [, bm] = await member(f.db, 'bob');
    await grant(f);
    await openAuction(f);
    const a = f.athletes[0];
    await bid(f, alice, am, a, 5);
    // Superuser writes: alice won `a` for 30; bob (moved to league B) got it free from the fill.
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 30, 'bid')`, [f.stage, am, f.league, a]);
    const league2 = (await f.db.query<{ id: string }>(`insert into public.leagues (season_id, name) values ($1, 'B') returning id`,
      [f.season])).rows[0].id;
    await f.db.query(`update public.memberships set league_id = $1 where id = $2`, [league2, bm]);
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 0, 'fill')`, [f.stage, bm, league2, a]);
    const week = (await f.db.query<{ id: string }>(`insert into public.weeks (stage_id, starts_on, ends_on, starts_at, ends_at, pick_lock_at)
      values ($1, '2026-10-19', '2026-10-25', '2026-10-19', '2026-10-26', '2026-10-20') returning id`, [f.stage])).rows[0].id;
    await f.db.query(`insert into public.picks (week_id, membership_id, league_id, athlete_id) values ($1, $2, $3, $4)`,
      [week, am, f.league, a]);
    const name = (await f.db.query<{ name: string }>(`select name from public.athletes where id = $1`, [a])).rows[0].name;
    const balance = async (m: string) =>
      (await f.db.query<{ b: number }>(`select coalesce(sum(amount), 0)::int as b from public.credit_ledger where membership_id = $1`, [m])).rows[0].b;
    const [aliceBefore, bobBefore] = [await balance(am), await balance(bm)];

    await as(f.db, f.admin, (tx) => rpc(tx, 'delete_athlete', { p_athlete: a, p_force: true }));

    expect((await f.db.query(`select 1 from public.athletes where id = $1`, [a])).rows).toHaveLength(0);
    for (const t of ['bids', 'roster_slots', 'picks']) {
      expect((await f.db.query(`select 1 from public.${t} where athlete_id = $1`, [a])).rows, t).toHaveLength(0);
    }
    expect(await balance(am)).toBe(aliceBefore + 30);
    expect(await balance(bm)).toBe(bobBefore);
    const refund = await f.db.query<{ kind: string; note: string; stage_id: string }>(
      `select kind, note, stage_id from public.credit_ledger where membership_id = $1 and amount = 30`, [am]);
    expect(refund.rows).toEqual([{ kind: 'adjustment', note: `Refund: ${name} removed`, stage_id: f.stage }]);
    expect((await audit(f.db, 'delete_athlete'))[0].details).toMatchObject({
      name, force: true, taps: 0, lines: 0, bids: 1, slots: 2, picks: 1, refunded: 30,
    });
  });

  it('wipes an athlete with taps and a stat line', async () => {
    const f = await statsFixture();
    const now = new Date().toISOString();
    await as(f.db, f.k1, (tx) =>
      rpc(tx, 'save_taps', { p_session: f.session, p_client_now: now, p_taps: [tap(f.sam, 'goal', now)] }));
    await f.db.query(`insert into public.stat_lines (session_id, athlete_id, stats) values ($1, $2, '{"goal": 1}')`, [f.session, f.sam]);
    await as(f.db, f.admin, (tx) => rpc(tx, 'delete_athlete', { p_athlete: f.sam, p_force: true }));
    expect((await f.db.query(`select 1 from public.stat_lines where athlete_id = $1`, [f.sam])).rows).toHaveLength(0);
    expect((await audit(f.db, 'delete_athlete'))[0].details).toMatchObject({ force: true, taps: 1, lines: 1, refunded: 0 });
  });

  it('refuses a keeper even when forced', async () => {
    const f = await statsFixture();
    await expect(as(f.db, f.k1, (tx) => rpc(tx, 'delete_athlete', { p_athlete: f.ali, p_force: true })))
      .rejects.toThrow('FORBIDDEN');
  });
});

describe('delete_session forced (t81)', () => {
  it('lets an admin delete a verified, locked session with taps and lines', async () => {
    const f = await statsFixture();
    const now = new Date().toISOString();
    await as(f.db, f.k1, (tx) =>
      rpc(tx, 'save_taps', { p_session: f.session, p_client_now: now, p_taps: [tap(f.sam, 'goal', now), tap(f.ali, 'block', now)] }));
    await f.db.query(`insert into public.stat_lines (session_id, athlete_id, stats) values ($1, $2, '{"goal": 1}')`, [f.session, f.sam]);
    await backdateVerify(f.db, f.session, 49);
    await as(f.db, f.admin, (tx) => rpc(tx, 'delete_session', { p_session: f.session, p_force: true }));
    expect((await f.db.query(`select 1 from public.sessions where id = $1`, [f.session])).rows).toHaveLength(0);
    expect((await f.db.query(`select 1 from public.stat_taps where session_id = $1`, [f.session])).rows).toHaveLength(0);
    expect((await audit(f.db, 'delete_session'))[0].details).toMatchObject({
      kind: 'practice', force: true, verified: true, taps: 2, lines: 1,
    });
  });

  it('refuses a keeper forcing, even the creator', async () => {
    const f = await statsFixture();
    await expect(as(f.db, f.k1, (tx) => rpc(tx, 'delete_session', { p_session: f.session, p_force: true })))
      .rejects.toThrow('FORBIDDEN');
    expect((await f.db.query(`select 1 from public.sessions where id = $1`, [f.session])).rows).toHaveLength(1);
  });
});

describe('delete_session', () => {
  it('lets the creator delete an empty unverified session, with an audit row', async () => {
    const f = await statsFixture();
    await as(f.db, f.k1, (tx) => rpc(tx, 'delete_session', { p_session: f.session }));
    expect((await f.db.query(`select 1 from public.sessions where id = $1`, [f.session])).rows).toHaveLength(0);
    expect((await audit(f.db, 'delete_session'))[0].details).toMatchObject({ kind: 'practice', held_on: '2026-11-16' });
  });

  it('refuses another keeper, and lets an admin delete anyone\'s session', async () => {
    const f = await statsFixture();
    await expect(as(f.db, f.k2, (tx) => rpc(tx, 'delete_session', { p_session: f.session }))).rejects.toThrow('FORBIDDEN');
    await as(f.db, f.admin, (tx) => rpc(tx, 'delete_session', { p_session: f.session }));
    expect((await f.db.query(`select 1 from public.sessions where id = $1`, [f.session])).rows).toHaveLength(0);
  });

  it('refuses a session with a saved tap, a verified session, and a missing one', async () => {
    const f = await statsFixture();
    const now = new Date().toISOString();
    await as(f.db, f.k1, (tx) =>
      rpc(tx, 'save_taps', { p_session: f.session, p_client_now: now, p_taps: [tap(f.sam, 'goal', now)] }));
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'delete_session', { p_session: f.session })))
      .rejects.toThrow('SESSION_NOT_EMPTY');
    const empty = (await as(f.db, f.k1, (tx) =>
      rpc(tx, 'create_session', { p_season: f.season, p_kind: 'practice', p_held_on: '2026-11-17', p_counts: true }))) as string;
    await f.db.query(`update public.sessions set verified_at = now() where id = $1`, [empty]);
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'delete_session', { p_session: empty }))).rejects.toThrow('SESSION_VERIFIED');
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'delete_session', { p_session: crypto.randomUUID() })))
      .rejects.toThrow('NOT_FOUND');
  });
});

describe('place_bid total cap', () => {
  async function ready() {
    const f = await auctionFixture();
    const [alice, am] = await member(f.db, 'alice');
    await member(f.db, 'bob'); // two tied managers: 115 each
    await grant(f);
    await openAuction(f);
    return { f, alice, am };
  }

  it('refuses a bid that pushes the total past the balance', async () => {
    const { f, alice, am } = await ready();
    await bid(f, alice, am, f.athletes[0], 100);
    await expect(bid(f, alice, am, f.athletes[1], 16)).rejects.toThrow('INSUFFICIENT_CREDITS');
    expect((await f.db.query(`select 1 from public.bids where membership_id = $1`, [am])).rows).toHaveLength(1);
  });

  it('allows a total exactly equal to the balance, and raising a bid within budget', async () => {
    const { f, alice, am } = await ready();
    await bid(f, alice, am, f.athletes[0], 100);
    await bid(f, alice, am, f.athletes[1], 15);
    await bid(f, alice, am, f.athletes[1], 5);
    await bid(f, alice, am, f.athletes[0], 110); // replaces its own 100, so 110 + 5 = 115
    const total = await f.db.query<{ t: number }>(`select sum(amount)::int as t from public.bids where membership_id = $1`, [am]);
    expect(total.rows[0].t).toBe(115);
  });
});
