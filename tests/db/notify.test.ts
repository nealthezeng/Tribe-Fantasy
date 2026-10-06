// M10 email notifications (spec 2026-10-05-m10-notifications-design.md §3–§5): what gets queued in private.outbox,
// and what the sender may claim. The Edge Function itself is checked by hand at go-live (no Deno in CI).
import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, bid, closeBids, grant, member, openAuction, runAuction, type AuctionFixture } from './auction-fixture';
import { makeKeeper } from './stats-fixture';

let f: AuctionFixture;
let keeper: string, alice: string, aliceM: string, bob: string, bobM: string, carol: string, carolM: string;

interface OutboxRow { id: number; membership_id: string; kind: string; ref: string; subject: string; body: string;
  tries: number; sent: boolean; error: string | null }

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
/** Superuser write: moves the close time without open_auction's checks. */
const setClose = (h: number) =>
  f.db.query(`update public.stages set bid_close_at = now() + $2 * interval '1 hour' where id = $1`, [f.stage, h]);
const queueBids = async () => (await f.db.query<{ n: number }>('select private.queue_bid_reminders() as n')).rows[0].n;
const outbox = async () => (await f.db.query<OutboxRow>(
  `select id::int as id, membership_id, kind, ref, subject, body, tries, sent_at is not null as sent, error
   from private.outbox order by id`)).rows;
const claim = async (limit = 50) => (await f.db.query<{ id: number; email: string; subject: string; body: string }>(
  'select id::int as id, email, subject, body from private.claim_outbox($1)', [limit])).rows;
const mark = (id: number, error: string | null) => f.db.query('select private.mark_outbox($1, $2)', [id, error]);
const optOut = (uid: string) => as(f.db, uid, (tx) => rpc(tx, 'set_notify_email', { p_on: false }));

const pairings = () => [
  { league_id: f.league, home: aliceM, away: bobM },
  { league_id: f.league, home: carolM, away: null },
];
const open = () => as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: pairings() })) as Promise<string>;
const start = (game: string) => as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game }));
const finish = (game: string) =>
  as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: pairings(), p_provisional: {} })) as Promise<string>;

beforeEach(async () => {
  f = await auctionFixture(16); // open_auction needs 3 members × roster 4 opted-in athletes
  keeper = await createUser(f.db, 'keeper@x.test');
  await makeKeeper(f.db, keeper);
  [alice, aliceM] = await member(f.db, 'alice');
  [bob, bobM] = await member(f.db, 'bob');
  [carol, carolM] = await member(f.db, 'carol');
});

describe('bid reminders', () => {
  it('queues nothing over 24 h out, bid_24h inside 24 h, and only bid_2h inside 2 h', async () => {
    await openAuction(f, hours(25));
    expect(await queueBids()).toBe(0);
    await setClose(23);
    expect(await queueBids()).toBe(3);
    expect((await outbox()).map((r) => r.kind)).toEqual(['bid_24h', 'bid_24h', 'bid_24h']);
    await setClose(1);
    expect(await queueBids()).toBe(3);
    const late = (await outbox()).slice(3);
    expect(late.map((r) => r.kind)).toEqual(['bid_2h', 'bid_2h', 'bid_2h']);
    expect(late[0].subject).toBe('Bidding for Fall beta closes within 2 hours');
  });

  it('never queues twice for the same close time, and queues again when the close moves', async () => {
    await openAuction(f, hours(23));
    expect(await queueBids()).toBe(3);
    expect(await queueBids()).toBe(0);
    await setClose(20);
    expect(await queueBids()).toBe(3);
    expect(new Set((await outbox()).map((r) => r.ref)).size).toBe(2);
  });

  it('says how many bids each team has placed, when bidding closes, and how to turn emails off', async () => {
    await grant(f);
    await openAuction(f, hours(23));
    await bid(f, alice, aliceM, f.athletes[0], 5);
    await bid(f, alice, aliceM, f.athletes[1], 5);
    await bid(f, bob, bobM, f.athletes[2], 5);
    await queueBids();
    const body = Object.fromEntries((await outbox()).map((r) => [r.membership_id, r.body]));
    expect(body[aliceM]).toMatch(/^alice: bidding for Fall beta closes \w{3} \w{3} \d{1,2}, \d{1,2}:\d{2} [AP]M ET\. You have placed 2 bids\./);
    expect(body[bobM]).toContain('You have placed 1 bid.');
    expect(body[carolM]).toContain("You haven't placed any bids yet.");
    expect(body[carolM]).toContain('Turn these emails off: https://nealthezeng.github.io/Tribe-Fantasy/#/me');
    expect((await outbox())[0].subject).toBe('Bidding for Fall beta closes within 24 hours');
  });

  it('queues nothing once bidding has closed or the auction has run', async () => {
    await grant(f);
    await openAuction(f, hours(1));
    await closeBids(f);
    expect(await queueBids()).toBe(0);
    await runAuction(f);
    await setClose(1); // a run auction never reminds, whatever its close time says
    expect(await queueBids()).toBe(0);
  });

  it('skips members who turned emails off; a member with no profile still gets them', async () => {
    await optOut(alice);
    await f.db.query('delete from public.profiles where id = $1', [carol]);
    await openAuction(f, hours(23));
    await queueBids();
    expect((await outbox()).map((r) => r.membership_id).sort()).toEqual([bobM, carolM].sort());
  });

  it('a manager in two leagues gets one reminder per team', async () => {
    await as(f.db, f.admin, async (tx) => {
      const b = (await rpc(tx, 'create_league', { p_season: f.season, p_name: 'League B' })) as string;
      await rpc(tx, 'create_invite', { p_league: b, p_code: 'LEAGUE2', p_max_uses: 50, p_expires_at: null });
    });
    const aliceB = (await as(f.db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'LEAGUE2', p_team_name: 'alice B' }))) as string;
    await openAuction(f, hours(23));
    await queueBids();
    const mine = (await outbox()).filter((r) => r.membership_id === aliceM || r.membership_id === aliceB);
    expect(mine.map((r) => r.body.split(':')[0]).sort()).toEqual(['alice', 'alice B']);
  });
});

describe('pick notices', () => {
  it('opening a tournament tells both sides of each pairing, not the team with a bye', async () => {
    const g1 = await open();
    const rows = await outbox();
    expect(rows.map((r) => [r.membership_id, r.kind, r.ref])).toEqual([[aliceM, 'pick_next', g1], [bobM, 'pick_next', g1]]);
    expect(rows[0].subject).toBe('Pick your player for game 1');
    expect(rows[0].body).toMatch(/^alice: game 1 of Fall beta is next\. You play bob\. Pick your player on the League page/);
    expect(rows[1].body).toContain('You play alice.');
    expect(rows[0].body).not.toContain('ignore this email'); // t202: a last game pairs nothing, so no stray notice
  });

  it('finishing game N tells only the managers with no pick yet for game N+1', async () => {
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 10, 'bid')`, [f.stage, aliceM, f.league, f.athletes[0]]);
    const g1 = await open();
    await start(g1);
    await as(f.db, alice, (tx) => rpc(tx, 'set_game_pick', { p_membership: aliceM, p_stage: f.stage, p_number: 2, p_athlete: f.athletes[0] }));
    const g2 = await finish(g1);
    expect((await outbox()).filter((r) => r.ref === g2).map((r) => r.membership_id)).toEqual([bobM]);
  });

  it('a last-game finish tells nobody; adding game N+1 afterwards tells both sides (t202)', async () => {
    const g1 = await open();
    await start(g1);
    const before = (await outbox()).length;
    await as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: g1, p_pairings: [], p_provisional: {}, p_last: true }));
    expect(await outbox()).toHaveLength(before);
    const g2 = await as(f.db, keeper, (tx) => rpc(tx, 'add_next_game', { p_game: g1, p_pairings: pairings(), p_provisional: {} }));
    expect((await outbox()).filter((r) => r.ref === g2)).toHaveLength(2);
  });

  it('skips managers who turned emails off', async () => {
    await optOut(bob);
    await open();
    expect((await outbox()).map((r) => r.membership_id)).toEqual([aliceM]);
  });

  it('after an admin undoes a game and it is finished again, the new next game gets fresh notices', async () => {
    const g1 = await open();
    await start(g1);
    const first = await finish(g1);
    await as(f.db, f.admin, (tx) => rpc(tx, 'reset_game', { p_game: g1 }));
    await start(g1);
    const second = await finish(g1);
    expect(second).not.toBe(first);
    expect((await outbox()).filter((r) => r.ref === second)).toHaveLength(2);
  });
});

describe('claim_outbox and mark_outbox', () => {
  it('hands out each due email once, with the address, and takes it back after a 5-minute lease', async () => {
    await open();
    const got = await claim();
    expect(got.map((r) => r.email).sort()).toEqual(['alice@x.test', 'bob@x.test']);
    expect(await claim()).toEqual([]);
    await f.db.query(`update private.outbox set claimed_at = now() - interval '6 minutes'`);
    expect(await claim()).toHaveLength(2);
    expect((await outbox()).map((r) => r.tries)).toEqual([2, 2]);
  });

  it('respects the limit without handing a row out twice', async () => {
    await open();
    const a = await claim(1);
    const b = await claim(50);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].id).not.toBe(b[0].id);
  });

  it('a sent email is never claimed again; a failed one is retried, at most 3 tries in all', async () => {
    await open();
    const [x, y] = await claim();
    await mark(x.id, null);
    await mark(y.id, 'smtp down');
    const rows = await outbox();
    expect(rows.map((r) => [r.sent, r.error])).toEqual([[true, null], [false, 'smtp down']]);
    for (let i = 0; i < 3; i++) {
      await f.db.query(`update private.outbox set claimed_at = now() - interval '6 minutes'`);
      const again = await claim();
      expect(again.map((r) => r.id)).toEqual(i < 2 ? [y.id] : []);
    }
  });

  it('drops emails queued over 30 minutes ago', async () => {
    await open();
    await f.db.query(`update private.outbox set created_at = now() - interval '31 minutes'`);
    expect(await claim()).toEqual([]);
  });

  it('drops a bid reminder once its close time moved, or once the auction ran', async () => {
    await grant(f);
    await openAuction(f, hours(23));
    await queueBids();
    await setClose(20);
    expect(await claim()).toEqual([]);
    await queueBids();
    await closeBids(f);
    await runAuction(f);
    expect(await claim()).toEqual([]);
  });

  it('drops a pick notice once its game has started, or once the game was deleted', async () => {
    const g1 = await open();
    await start(g1);
    expect(await claim()).toEqual([]);
    const g2 = await finish(g1);
    await as(f.db, f.admin, (tx) => rpc(tx, 'reset_game', { p_game: g1 })); // deletes the unstarted g2, un-starts g1
    const due = await claim();
    const byId = new Map((await outbox()).map((r) => [r.id, r.ref]));
    expect(due.map((r) => byId.get(r.id))).toEqual([g1, g1]); // game 1 is unplayed again; game 2 is gone
    expect((await outbox()).some((r) => r.ref === g2)).toBe(true);
  });

  it('drops a pick notice when the manager picked after it was queued', async () => {
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 10, 'bid')`, [f.stage, aliceM, f.league, f.athletes[0]]);
    await open();
    await as(f.db, alice, (tx) => rpc(tx, 'set_game_pick', { p_membership: aliceM, p_stage: f.stage, p_number: 1, p_athlete: f.athletes[0] }));
    expect((await claim()).map((r) => r.email)).toEqual(['bob@x.test']);
  });
});

describe('set_notify_email', () => {
  it('turns only the caller’s own emails on and off, with an audit row', async () => {
    await optOut(alice);
    const on = async (uid: string) =>
      (await f.db.query<{ v: boolean }>('select notify_email as v from public.profiles where id = $1', [uid])).rows[0].v;
    expect([await on(alice), await on(bob)]).toEqual([false, true]);
    await as(f.db, alice, (tx) => rpc(tx, 'set_notify_email', { p_on: true }));
    expect(await on(alice)).toBe(true);
    expect((await f.db.query(`select 1 from public.audit_log where action = 'set_notify_email' and actor = $1`, [alice])).rows)
      .toHaveLength(2);
  });

  it('refuses anonymous callers, null, and users with no profile', async () => {
    await expect(as(f.db, null, (tx) => rpc(tx, 'set_notify_email', { p_on: false }))).rejects.toThrow();
    await expect(as(f.db, alice, (tx) => rpc(tx, 'set_notify_email', { p_on: null }))).rejects.toThrow('INVALID_INPUT');
    const nameless = await createUser(f.db, 'nameless@x.test');
    await expect(as(f.db, nameless, (tx) => rpc(tx, 'set_notify_email', { p_on: false }))).rejects.toThrow('NOT_FOUND');
  });
});
