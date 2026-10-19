import { describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import {
  auctionFixture, bid, closeBids, grant, inAnHour, injure, member, openAuction, runAuction, slots, unbid,
  type AuctionFixture,
} from './auction-fixture';

import { makeKeeper } from './stats-fixture';
const settings = (f: AuctionFixture, s: object) =>
  as(f.db, f.admin, (tx) => rpc(tx, 'update_season_settings', { p_season: f.season, p_settings: s }));
const stageRow = async (f: AuctionFixture) =>
  (await f.db.query<{ bid_close_at: string | null; auction_seed: string | null; auction_run_at: string | null }>(
    `select bid_close_at, auction_seed, auction_run_at from public.stages where id = $1`, [f.stage])).rows[0];
const ledger = async (f: AuctionFixture, mid: string) =>
  (await f.db.query<{ kind: string; amount: number }>(
    `select kind, amount from public.credit_ledger where membership_id = $1 and kind = 'bid' order by id`, [mid])).rows;

describe('open_auction', () => {
  it('sets and moves the close time without revealing a seed', async () => {
    const f = await auctionFixture();
    await member(f.db, 'alice');
    await openAuction(f);
    const first = await stageRow(f);
    expect(first.bid_close_at).not.toBeNull();
    expect(first.auction_seed).toBeNull();
    await openAuction(f, new Date(Date.now() + 7_200_000).toISOString());
    const moved = await stageRow(f);
    expect(moved.auction_seed).toBeNull();
    expect(new Date(moved.bid_close_at!).getTime()).toBeGreaterThan(new Date(first.bid_close_at!).getTime());
    const log = await f.db.query(`select 1 from public.audit_log where action = 'open_auction'`);
    expect(log.rows).toHaveLength(2);
  });

  it('refuses a close time in the past, and changes after close or after the run', async () => {
    const f = await auctionFixture();
    await expect(openAuction(f, new Date(Date.now() - 1000).toISOString())).rejects.toThrow('INVALID_CLOSE_TIME');
    await expect(openAuction(f, null)).rejects.toThrow('INVALID_CLOSE_TIME');
    await openAuction(f);
    await closeBids(f);
    await expect(openAuction(f)).rejects.toThrow('BID_CLOSED');
    await runAuction(f);
    await expect(openAuction(f)).rejects.toThrow('AUCTION_ALREADY_RUN');
  });

  it('refuses only when no healthy opted-in athlete is left (C10)', async () => {
    const f = await auctionFixture(2);
    await member(f.db, 'alice');
    await member(f.db, 'bob');
    await injure(f, f.athletes[0]);
    await openAuction(f); // 2 teams × 6 players > 1 healthy athlete: fine with shares
    await as(f.db, f.admin, (tx) => rpc(tx, 'set_athlete_opt_in', { p_athlete: f.athletes[1], p_opted_in: false }));
    await expect(openAuction(f)).rejects.toThrow('NOT_ENOUGH_ATHLETES');
  });

  it('is admin-only', async () => {
    const f = await auctionFixture();
    const [alice] = await member(f.db, 'alice');
    await expect(as(f.db, alice, (tx) => rpc(tx, 'open_auction', { p_stage: f.stage, p_close_at: inAnHour() })))
      .rejects.toThrow('FORBIDDEN');
  });
});

describe('place_bid and delete_bid', () => {
  async function ready() {
    const f = await auctionFixture();
    const [alice, am] = await member(f.db, 'alice');
    const [bob, bm] = await member(f.db, 'bob');
    await grant(f); // 115 each
    return { f, alice, am, bob, bm };
  }

  it('refuses before the auction opens and after it closes', async () => {
    const { f, alice, am } = await ready();
    await expect(bid(f, alice, am, f.athletes[0], 10)).rejects.toThrow('AUCTION_NOT_OPEN');
    await openAuction(f);
    await bid(f, alice, am, f.athletes[0], 10);
    await closeBids(f);
    await expect(bid(f, alice, am, f.athletes[1], 10)).rejects.toThrow('BID_CLOSED');
    await expect(unbid(f, alice, am, f.athletes[0])).rejects.toThrow('BID_CLOSED');
  });

  it("refuses someone else's team and a team from another season", async () => {
    const { f, alice, bm } = await ready();
    await openAuction(f);
    await expect(bid(f, alice, bm, f.athletes[0], 10)).rejects.toThrow('NOT_MEMBER');
    await expect(unbid(f, alice, bm, f.athletes[0])).rejects.toThrow('NOT_MEMBER');
    const other = await as(f.db, f.admin, async (tx) => {
      const s = (await rpc(tx, 'create_season', { p_name: 'Other', p_settings: {} })) as string;
      const l = (await rpc(tx, 'create_league', { p_season: s, p_name: 'L' })) as string;
      await rpc(tx, 'create_invite', { p_league: l, p_code: 'OTHER1', p_max_uses: 5, p_expires_at: null });
      return s;
    });
    expect(other).toBeTruthy();
    const om = (await as(f.db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'OTHER1', p_team_name: 'alice2' }))) as string;
    await expect(bid(f, alice, om, f.athletes[0], 10)).rejects.toThrow('NOT_MEMBER');
  });

  it('checks the athlete, self-ownership and the amount', async () => {
    const { f, alice, am } = await ready();
    await openAuction(f);
    await as(f.db, f.admin, (tx) => rpc(tx, 'set_athlete_opt_in', { p_athlete: f.athletes[7], p_opted_in: false }));
    await expect(bid(f, alice, am, f.athletes[7], 10)).rejects.toThrow('NOT_OPTED_IN');
    await expect(bid(f, alice, am, crypto.randomUUID(), 10)).rejects.toThrow('NOT_OPTED_IN');
    await f.db.query(`update public.athletes set user_id = $1 where id = $2`, [alice, f.athletes[6]]);
    await expect(bid(f, alice, am, f.athletes[6], 10)).rejects.toThrow('SELF_OWNERSHIP');
    await settings(f, { allow_self_ownership: true });
    await bid(f, alice, am, f.athletes[6], 10);
    await expect(bid(f, alice, am, f.athletes[0], 0)).rejects.toThrow('INVALID_AMOUNT'); // min_bid 1
    await expect(bid(f, alice, am, f.athletes[0], null)).rejects.toThrow('INVALID_AMOUNT');
    await expect(bid(f, alice, am, f.athletes[0], 116)).rejects.toThrow('INSUFFICIENT_CREDITS');
    await expect(bid(f, alice, am, f.athletes[0], 106)).rejects.toThrow('INSUFFICIENT_CREDITS'); // 10 already on A6
    await bid(f, alice, am, f.athletes[0], 105);
  });

  it('edits in place, resetting placed_at, and deletes', async () => {
    const { f, alice, am } = await ready();
    await openAuction(f);
    await bid(f, alice, am, f.athletes[0], 10);
    await f.db.query(`update public.bids set placed_at = placed_at - interval '1 hour'`);
    const before = (await f.db.query<{ placed_at: Date }>(`select placed_at from public.bids`)).rows[0].placed_at;
    await bid(f, alice, am, f.athletes[0], 20);
    const rows = (await f.db.query<{ amount: number; placed_at: Date }>(`select amount, placed_at from public.bids`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(20);
    expect(rows[0].placed_at.getTime()).toBeGreaterThan(before.getTime());
    await unbid(f, alice, am, f.athletes[0]);
    await unbid(f, alice, am, f.athletes[0]); // a missing bid is a no-op
    expect((await f.db.query(`select 1 from public.bids`)).rows).toHaveLength(0);
    const log = await f.db.query<{ details: object }>(`select details from public.audit_log where action = 'place_bid'`);
    expect(JSON.stringify(log.rows)).not.toContain('"amount"'); // sealed: no amounts in the admin-readable log
    expect(JSON.stringify(log.rows)).not.toContain(f.athletes[0]); // sealed: no athlete ids in the log
    const deleteLog = await f.db.query<{ details: object }>(`select details from public.audit_log where action = 'delete_bid'`);
    expect(JSON.stringify(deleteLog.rows)).not.toContain(f.athletes[0]); // sealed: no athlete ids in the log
  });
});

describe('bid and roster visibility', () => {
  it('keeps bids sealed until close, then shows them to the league and staff (admins see them any time)', async () => {
    const f = await auctionFixture();
    const [alice, am] = await member(f.db, 'alice');
    const [bob, bm] = await member(f.db, 'bob');
    const outsider = await createUser(f.db, 'out@x.test');
    const keeper = await createUser(f.db, 'keeper@x.test');
    await makeKeeper(f.db, keeper);
    await grant(f);
    await openAuction(f);
    await bid(f, alice, am, f.athletes[0], 10);
    await bid(f, bob, bm, f.athletes[0], 20);
    const seen = (uid: string) => as(f.db, uid, async (tx) => (await tx.query(`select amount from public.bids order by amount`)).rows);
    expect(await seen(alice)).toEqual([{ amount: 10 }]);
    expect(await seen(keeper)).toEqual([]); // other staff can't peek
    expect(await seen(f.admin)).toEqual([{ amount: 10 }, { amount: 20 }]); // admins can (M14)
    await closeBids(f);
    expect(await seen(alice)).toEqual([{ amount: 10 }, { amount: 20 }]);
    expect(await seen(f.admin)).toEqual([{ amount: 10 }, { amount: 20 }]);
    expect(await seen(outsider)).toEqual([]);

    await runAuction(f);
    const roster = (uid: string) => as(f.db, uid, async (tx) => (await tx.query(`select 1 from public.roster_slots`)).rows.length);
    expect(await roster(alice)).toBe(2); // both buys on A0
    expect(await roster(outsider)).toBe(0);
  });
});

describe('run_auction', () => {
  it('only runs once, after close', async () => {
    const f = await auctionFixture();
    await expect(runAuction(f)).rejects.toThrow('AUCTION_NOT_OPEN');
    await openAuction(f);
    await expect(runAuction(f)).rejects.toThrow('AUCTION_NOT_CLOSED');
    await closeBids(f);
    await runAuction(f);
    await expect(runAuction(f)).rejects.toThrow('AUCTION_ALREADY_RUN');
    const st = await stageRow(f);
    expect(st.auction_run_at).not.toBeNull();
    expect(st.auction_seed).toBeNull(); // no fill, so no seed
  });

  it('keeps only the largest roster_size buys when the setting dropped after buying', async () => {
    const f = await auctionFixture(8);
    const [alice, am] = await member(f.db, 'alice');
    await member(f.db, 'bob');
    await grant(f);
    await openAuction(f);
    const [a0, a1, a2] = f.athletes;
    await bid(f, alice, am, a0, 30);
    await bid(f, alice, am, a1, 20);
    await bid(f, alice, am, a2, 10);
    await settings(f, { roster_size: 2 });
    await closeBids(f);
    expect(await runAuction(f)).toEqual({ by_bid: 2, empty: 2 });
    expect((await slots(f)).map((s) => [s.athlete_id, s.price]).sort()).toEqual([[a0, 30], [a1, 20]].sort());
    expect(await ledger(f, am)).toHaveLength(2);
  });

  it('skips a bid the manager can no longer afford after an adjustment lowers the balance', async () => {
    const f = await auctionFixture(8, { roster_size: 1 });
    const [alice, am] = await member(f.db, 'alice');
    const [bob, bm] = await member(f.db, 'bob');
    await grant(f); // 115 each
    await openAuction(f);
    await bid(f, alice, am, f.athletes[0], 100);
    await bid(f, bob, bm, f.athletes[0], 50);
    await as(f.db, f.admin, (tx) => rpc(tx, 'adjust_credits', { p_membership: am, p_amount: -30, p_note: 'fix' }));
    await closeBids(f);
    await runAuction(f);
    expect((await slots(f)).find((s) => s.athlete_id === f.athletes[0])).toMatchObject({ membership_id: bm, price: 50 });
    expect(await ledger(f, am)).toEqual([]);
  });

  it('ignores a buy of 0 credits: it would own nothing', async () => {
    const f = await auctionFixture(8, { min_bid: 0, roster_size: 1 });
    const [alice, am] = await member(f.db, 'alice');
    await grant(f);
    await openAuction(f);
    await bid(f, alice, am, f.athletes[0], 0);
    await closeBids(f);
    expect(await runAuction(f)).toEqual({ by_bid: 0, empty: 1 });
    expect(await slots(f)).toEqual([]);
    expect(await ledger(f, am)).toEqual([]);
  });

  it('ignores bids on athletes who opted out after bidding', async () => {
    const f = await auctionFixture(8, { roster_size: 1 });
    const [alice, am] = await member(f.db, 'alice');
    await grant(f);
    await openAuction(f);
    await bid(f, alice, am, f.athletes[0], 50);
    await as(f.db, f.admin, (tx) => rpc(tx, 'set_athlete_opt_in', { p_athlete: f.athletes[0], p_opted_in: false }));
    await closeBids(f);
    await runAuction(f);
    expect(await slots(f)).toEqual([]); // and no fill takes its place
    expect(await ledger(f, am)).toEqual([]);
  });

  it('ignores a buy of your own athlete, and still sells an injured one', async () => {
    const f = await auctionFixture(8, { allow_self_ownership: true });
    const [alice, am] = await member(f.db, 'alice');
    await grant(f);
    await openAuction(f);
    await f.db.query(`update public.athletes set user_id = $1 where id = $2`, [alice, f.athletes[0]]);
    await bid(f, alice, am, f.athletes[0], 5);
    await settings(f, { allow_self_ownership: false }); // turned off after the buy
    await injure(f, f.athletes[1]);
    await bid(f, alice, am, f.athletes[1], 5);
    await closeBids(f);
    await runAuction(f);
    expect(await slots(f)).toEqual([{ membership_id: am, athlete_id: f.athletes[1], price: 5, via: 'bid' }]);
  });

  it('pools each league separately', async () => {
    const f = await auctionFixture(4, { min_shares: 20 }); // under a 200 floor pooling wouldn't show
    await as(f.db, f.admin, async (tx) => {
      const b = (await rpc(tx, 'create_league', { p_season: f.season, p_name: 'League B' })) as string;
      await rpc(tx, 'create_invite', { p_league: b, p_code: 'LEAGUE2', p_max_uses: 50, p_expires_at: null });
    });
    const [a, am] = await member(f.db, 'a1');
    const [b, bm] = await member(f.db, 'b1', 'LEAGUE2');
    await grant(f);
    await openAuction(f);
    await bid(f, a, am, f.athletes[0], 30);
    await bid(f, b, bm, f.athletes[0], 10);
    await closeBids(f);
    expect(await runAuction(f)).toEqual({ by_bid: 2, empty: 10 });
    const shares = await f.db.query<{ membership_id: string; share: number }>(
      'select membership_id, share::float8 as share from public.roster_slots order by share desc');
    expect(shares.rows).toEqual([{ membership_id: am, share: 1 }, { membership_id: bm, share: 0.5 }]);
  });
});

describe('owns_athlete', () => {
  it('is true for athletes on your roster in the latest stage whose auction ran', async () => {
    const f = await auctionFixture(8, { roster_size: 1 });
    const [alice, am] = await member(f.db, 'alice');
    await grant(f);
    const owns = async (athlete: string) =>
      (await f.db.query<{ o: boolean }>(`select private.owns_athlete($1, $2) as o`, [alice, athlete])).rows[0].o;
    await openAuction(f);
    await bid(f, alice, am, f.athletes[0], 5);
    await closeBids(f);
    expect(await owns(f.athletes[0])).toBe(false); // not run yet
    await runAuction(f);
    expect(await owns(f.athletes[0])).toBe(true);
    expect(await owns(f.athletes[1])).toBe(false);
    // A later stage that hasn't run yet doesn't change ownership; once it runs, it takes over.
    const spring = (await as(f.db, f.admin, (tx) => rpc(tx, 'create_stage', {
      p_season: f.season, p_name: 'Spring 1', p_starts_on: '2027-02-01', p_ends_on: '2027-02-21', p_tournament: null,
    }))) as string;
    expect(await owns(f.athletes[0])).toBe(true);
    await f.db.query(`update public.stages set bid_close_at = now(), auction_run_at = now(),
      starts_on = current_date - 1, ends_on = current_date + 20 where id = $1`, [spring]);
    // Fall hasn't ended (or ended under a week ago): its owners still own, for its closing tournament (0009).
    await f.db.query(`update public.stages set starts_on = current_date - 20, ends_on = current_date - 2 where id = $1`, [f.stage]);
    expect(await owns(f.athletes[0])).toBe(true);
    await f.db.query(`update public.stages set starts_on = current_date - 30, ends_on = current_date - 8 where id = $1`, [f.stage]);
    expect(await owns(f.athletes[0])).toBe(false);
  });
});
