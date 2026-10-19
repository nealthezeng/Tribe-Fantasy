// M13 shares (spec 2026-10-16-shares-design.md §4): share settlement, the 6-player cap, 2-pick sets, the reduced
// supply check, and 0023 applied on top of a live database that still has bench data.
import { describe, expect, it } from 'vitest';
import { as, createUser, freshDb, makeAdmin, migrationSql, rpc } from './helpers';
import {
  auctionFixture, bid, closeBids, grant, member, openAuction, runAuction, type AuctionFixture,
} from './auction-fixture';
import { makeKeeper } from './stats-fixture';

const slotsOf = async (f: AuctionFixture) => (await f.db.query<{ membership_id: string; athlete_id: string; price: number; share: number; via: string }>(
  `select membership_id, athlete_id, price, share::float8 as share, via from public.roster_slots where stage_id = $1
   order by price desc`, [f.stage])).rows;
const spent = async (f: AuctionFixture, mid: string) => (await f.db.query<{ amount: number }>(
  `select amount from public.credit_ledger where membership_id = $1 and kind = 'bid' order by amount`, [mid])).rows.map((r) => r.amount);

describe('run_auction', () => {
  it('splits a player by credits', async () => {
    const f = await auctionFixture(8, { min_shares: 20 }); // a floor the 150 credits on a1 clear
    const [alice, am] = await member(f.db, 'alice');
    const [bob, bm] = await member(f.db, 'bob');
    await grant(f);
    await openAuction(f);
    const [, a1, a2] = f.athletes;
    await bid(f, alice, am, a1, 100);
    await bid(f, bob, bm, a1, 50);
    await bid(f, bob, bm, a2, 1);
    await closeBids(f);
    expect(await runAuction(f)).toEqual({ by_bid: 3, empty: 2 * 6 - 3 });
    const s = await slotsOf(f);
    expect(s.map((x) => [x.membership_id, x.athlete_id, x.price, x.via])).toEqual([
      [am, a1, 100, 'bid'], [bm, a1, 50, 'bid'], [bm, a2, 1, 'bid']]);
    expect(s.map((x) => x.share)).toEqual([expect.closeTo(2 / 3, 6), expect.closeTo(1 / 3, 6), 0.05]);
    expect(await spent(f, am)).toEqual([-100]);
    expect(await spent(f, bm)).toEqual([-50, -1]);
    expect((await f.db.query(`select 1 from public.roster_slots where via = 'fill'`)).rows).toEqual([]);
    const log = await f.db.query<{ details: object }>(`select details from public.audit_log where action = 'run_auction'`);
    expect(log.rows[0].details).toEqual({ by_bid: 3, empty: 9 });
  });

  it('C5: keeps the largest buys that still fit a balance cut after buying, and charges nothing for the rest', async () => {
    const f = await auctionFixture(8);
    const [alice, am] = await member(f.db, 'alice');
    await grant(f); // 100 for a league of one
    await openAuction(f);
    const [a0, a1, a2] = f.athletes;
    await bid(f, alice, am, a0, 50);
    await bid(f, alice, am, a1, 40);
    await bid(f, alice, am, a2, 5);
    await as(f.db, f.admin, (tx) => rpc(tx, 'adjust_credits', { p_membership: am, p_amount: -40, p_note: 'fix' })); // 60 left
    await closeBids(f);
    await runAuction(f); // 50 fits (10 left), 40 doesn't, 5 does
    expect((await slotsOf(f)).map((x) => [x.athlete_id, x.price, x.share])).toEqual([[a0, 50, 0.25], [a2, 5, 0.025]]); // default min_shares 200
    expect(await spent(f, am)).toEqual([-50, -5]);
  });
});

describe('place_bid', () => {
  it('refuses a 7th player, but a re-bid on one of the six still works', async () => {
    const f = await auctionFixture(8);
    const [alice, am] = await member(f.db, 'alice');
    await grant(f);
    await openAuction(f);
    for (const a of f.athletes.slice(0, 6)) await bid(f, alice, am, a, 1);
    await expect(bid(f, alice, am, f.athletes[6], 1)).rejects.toThrow('TOO_MANY_PLAYERS');
    await bid(f, alice, am, f.athletes[0], 2);
  });
});

describe('set_game_pick', () => {
  it('takes up to picks_per_game players', async () => {
    const f = await auctionFixture(8);
    const keeper = await createUser(f.db, 'keeper@x.test');
    await makeKeeper(f.db, keeper);
    const [alice, am] = await member(f.db, 'alice');
    const [, bm] = await member(f.db, 'bob');
    const [, a1, a2, a3, a4] = f.athletes;
    for (const a of [a1, a2, a3]) {
      await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
        values ($1, $2, $3, $4, 10, 'bid')`, [f.stage, am, f.league, a]);
    }
    // A Postgres array literal: the rpc helper sends arrays as JSON (PostgREST converts them itself).
    const pick = (athletes: string[] | null) => as(f.db, alice, (tx) => rpc(tx, 'set_game_pick',
      { p_membership: am, p_stage: f.stage, p_number: 1, p_athletes: athletes && `{${athletes.join(',')}}` }));
    const picks = async () => (await f.db.query<{ athlete_id: string }>(
      'select athlete_id from public.game_picks order by athlete_id')).rows.map((r) => r.athlete_id);

    await pick([a2, a1]);
    expect(await picks()).toEqual([a1, a2].sort());
    await expect(pick([a1, a2, a3])).rejects.toThrow('TOO_MANY_PICKS');
    await pick([a3, a3]); // a repeat counts once
    expect(await picks()).toEqual([a3]);
    await pick([]);
    expect(await picks()).toEqual([]);
    await pick([a1]);
    await pick(null);
    expect(await picks()).toEqual([]);
    await expect(pick([a1, a4])).rejects.toThrow('NOT_ON_ROSTER');
    await pick([a1, a2]);
    const g1 = (await as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament',
      { p_stage: f.stage, p_pairings: [{ league_id: f.league, home: am, away: bm }] }))) as string;
    await as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: g1 }));
    await expect(pick([a3])).rejects.toThrow('PICK_LOCKED');
    expect(await picks()).toEqual([a1, a2].sort());
  });
});

describe('open_auction', () => {
  it('no longer needs members × roster players', async () => {
    const f = await auctionFixture(23, { max_members: 12 });
    for (let i = 0; i < 12; i++) await member(f.db, `m${i}`);
    await openAuction(f);
    await f.db.query('insert into public.injuries (athlete_id, confirmed_at) select id, now() from public.athletes');
    await expect(openAuction(f)).rejects.toThrow('NOT_ENOUGH_ATHLETES');
  });
});

describe('0023 on a live database', () => {
  it('strips bench_size and exclusive_ownership from stored settings, keeping bench-era rows', async () => {
    const db = await freshDb('0023');
    const admin = await createUser(db, 'admin@x.test');
    await makeAdmin(db, admin);
    const { season, league, stage, athletes } = await as(db, admin, async (tx) => {
      const season = (await rpc(tx, 'create_season', { p_name: 'Live',
        p_settings: { bench_size: 1, exclusive_ownership: true, roster_size: 4 } })) as string;
      const league = (await rpc(tx, 'create_league', { p_season: season, p_name: 'League A' })) as string;
      await rpc(tx, 'create_invite', { p_league: league, p_code: 'LEAGUE1', p_max_uses: 50, p_expires_at: null });
      const stage = (await rpc(tx, 'create_stage', {
        p_season: season, p_name: 'Feasterns', p_starts_on: '2026-10-17', p_ends_on: '2026-10-18', p_tournament: null })) as string;
      const athletes: string[] = [];
      for (const n of ['A0', 'A1']) athletes.push((await rpc(tx, 'add_athlete', { p_season: season, p_name: n, p_user: null })) as string);
      return { season, league, stage, athletes };
    });
    const [, mid] = await member(db, 'alice');
    for (const [a, bench] of [[athletes[0], false], [athletes[1], true]] as const) {
      await db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via, bench)
        values ($1, $2, $3, $4, 10, 'bid', $5)`, [stage, mid, league, a, bench]);
    }
    await db.query(`insert into public.game_picks (stage_id, game_number, membership_id, league_id, athlete_id)
      values ($1, 1, $2, $3, $4)`, [stage, mid, league, athletes[0]]);
    await db.query(`insert into public.bench_swaps (stage_id, membership_id, out_athlete, in_athlete, from_game)
      values ($1, $2, $3, $4, 2)`, [stage, mid, athletes[0], athletes[1]]);

    await db.exec(migrationSql('0023_shares.sql'));

    const s = await db.query<{ settings: object }>('select settings from public.seasons where id = $1', [season]);
    expect(s.rows[0].settings).toEqual({ roster_size: 4 });
    const slots = await db.query<{ share: number }>('select share::float8 as share from public.roster_slots');
    expect(slots.rows).toEqual([{ share: 1 }, { share: 1 }]);
    expect((await db.query('select 1 from public.game_picks')).rows).toHaveLength(1);
    expect((await db.query(`select to_regclass('public.bench_swaps') as t`)).rows).toEqual([{ t: null }]);
  });
});
