// Live scores (0028): live_game_taps returns a started, unverified game's taps with keeper numbers, never keeper ids.
import { beforeEach, describe, expect, it } from 'vitest';
import { mergeTaps } from '../../src/core/taps';
import { rowToTap } from '../../src/app/tally/queue';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, member, type AuctionFixture } from './auction-fixture';
import { makeKeeper, tap } from './stats-fixture';

let f: AuctionFixture;
let k1: string, k2: string, k3: string, alice: string, stranger: string;
let aliceM: string, bobM: string, carolM: string;
let g1: string, session: string;
let sam: string, ali: string;

interface LiveRow { id: string; athlete_id: string; stat: string; tapped_at: Date; undoes: string | null; keeper: number }

const pairings = () => [
  { league_id: f.league, home: aliceM, away: bobM },
  { league_id: f.league, home: carolM, away: null },
];
const live = (who: string | null, game: string | null) =>
  as(f.db, who, (tx) => tx.query<LiveRow>('select * from public.live_game_taps($1)', [game])).then((r) => r.rows);
const save = (who: string, taps: ReturnType<typeof tap>[]) =>
  as(f.db, who, (tx) => rpc(tx, 'save_taps', { p_session: session, p_client_now: new Date().toISOString(), p_taps: taps }));
const finish = () => as(f.db, k1, (tx) =>
  rpc(tx, 'finish_game', { p_game: g1, p_pairings: pairings(), p_provisional: {} }));
const verify = () => as(f.db, k3, (tx) =>
  rpc(tx, 'verify_session', { p_session: session, p_lines: [{ athlete_id: sam, stats: { goal: 1 } }] }));

const T0 = Date.now() - 120_000;
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

beforeEach(async () => {
  f = await auctionFixture(4);
  [sam, ali] = f.athletes;
  [k1, k2, k3] = await Promise.all(['k1', 'k2', 'k3'].map((n) => createUser(f.db, `${n}@x.test`)));
  for (const k of [k1, k2, k3]) await makeKeeper(f.db, k);
  stranger = await createUser(f.db, 'stranger@x.test');
  [alice, aliceM] = await member(f.db, 'alice');
  [, bobM] = await member(f.db, 'bob');
  [, carolM] = await member(f.db, 'carol');
  g1 = (await as(f.db, f.admin, (tx) =>
    rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: pairings(), p_games: 2 }))) as string;
  session = (await as(f.db, k1, (tx) => rpc(tx, 'start_game', { p_game: g1 }))) as string;
});

describe('live_game_taps', () => {
  it("returns a live game's taps to a league member with keeper numbers, not ids", async () => {
    const a = tap(sam, 'goal', at(0));
    const b = tap(sam, 'goal', at(3));
    const c = tap(sam, 'assist', at(10));
    await save(k2, [b]); // saved first, but k1 tapped first in the game
    await save(k1, [a, c]);
    const rows = await live(alice, g1);
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id, c.id]);
    expect(Object.keys(rows[0])).toEqual(['id', 'athlete_id', 'stat', 'tapped_at', 'undoes', 'keeper']);
    expect(rows.map((r) => r.keeper)).toEqual([1, 2, 1]);
    expect(JSON.stringify(rows)).not.toContain(k1);
    expect(JSON.stringify(rows)).not.toContain(k2);
  });

  it('returns undo rows with their link', async () => {
    const a = tap(sam, 'goal', at(0));
    const u = tap(sam, 'goal', at(2), a.id);
    await save(k1, [a, u]);
    const rows = await live(alice, g1);
    expect(rows).toHaveLength(2);
    expect(rows[1].undoes).toBe(rows[0].id);
    expect(rows[0].undoes).toBeNull();
  });

  it('keeps returning taps after Finish until the game is verified', async () => {
    await save(k1, [tap(sam, 'goal', at(0))]);
    await finish();
    expect(await live(alice, g1)).toHaveLength(1);
    await verify();
    expect(await live(alice, g1)).toEqual([]);
  });

  it('returns nothing for an unstarted, unknown or null game', async () => {
    const g2 = (await f.db.query<{ id: string }>('select id from public.games where stage_id = $1 and number = 2', [f.stage])).rows[0].id;
    await save(k1, [tap(sam, 'goal', at(0))]);
    expect(await live(alice, g2)).toEqual([]);
    expect(await live(alice, crypto.randomUUID())).toEqual([]);
    expect(await live(alice, null)).toEqual([]);
  });

  it('lets staff without a team read it, refuses a signed-in user outside every league', async () => {
    await save(k1, [tap(sam, 'goal', at(0))]);
    expect(await live(k2, g1)).toHaveLength(1);
    await expect(live(stranger, g1)).rejects.toThrow('FORBIDDEN');
  });

  it('is not callable by anon', async () => {
    await expect(live(null, g1)).rejects.toThrow(/permission denied/);
  });

  it('gives removed keepers one shared number', async () => {
    await save(k1, [tap(sam, 'goal', at(0))]);
    await save(k2, [tap(ali, 'goal', at(3))]);
    await f.db.query('update public.stat_taps set keeper_id = null where session_id = $1', [session]);
    expect((await live(alice, g1)).map((r) => r.keeper)).toEqual([1, 1]);
  });

  it('merges exactly like the verify screen', async () => {
    const a = tap(sam, 'goal', at(0));
    const b = tap(sam, 'goal', at(2)); // the same goal, seen by k2 a moment later: merged
    const c = tap(ali, 'assist', at(30));
    const u = tap(ali, 'assist', at(35), c.id);
    const d = tap(ali, 'goal', at(60));
    await save(k1, [a, c, u]);
    await save(k2, [b, d]);
    const rows = await live(alice, g1);
    const viaRpc = mergeTaps(rows.map((r) => rowToTap({ ...r, tapped_at: r.tapped_at.toISOString(), keeper_id: `k${r.keeper}` })), 10);
    const direct = (await f.db.query<{ id: string; athlete_id: string; stat: string; keeper_id: string; tapped_at: Date; undoes: string | null }>(
      'select id, athlete_id, stat, keeper_id, tapped_at, undoes from public.stat_taps where session_id = $1', [session])).rows;
    const viaTable = mergeTaps(direct.map((r) => rowToTap({ ...r, tapped_at: r.tapped_at.toISOString() })), 10);
    expect(viaRpc.merged.length).toBeGreaterThan(0);
    expect(viaRpc.counts).toEqual(viaTable.counts);
  });
});
