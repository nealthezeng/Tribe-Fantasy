// Admin powers (spec 2026-10-03-admin-powers-design.md §2–§4): delete a tournament keeping its credits, undo the
// newest played game, name games after the opponent.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, bid, grant, member, openAuction, type AuctionFixture } from './auction-fixture';
import { makeKeeper, tap } from './stats-fixture';

let f: AuctionFixture;
let keeper: string, alice: string, aliceM: string, bobM: string;

const pairings = () => [{ league_id: f.league, home: aliceM, away: bobM }];
const open = () => as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: pairings() })) as Promise<string>;
const start = (game: string) => as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game })) as Promise<string>;
const finish = (game: string) =>
  as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: pairings(), p_provisional: {} })) as Promise<string>;
const reset = (game: string, who = f.admin) => as(f.db, who, (tx) => rpc(tx, 'reset_game', { p_game: game }));
const name = (game: string, n: string | null, who = keeper) =>
  as(f.db, who, (tx) => rpc(tx, 'set_game_opponent', { p_game: game, p_name: n }));
const count = async (sql: string, args: unknown[] = []) =>
  (await f.db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, args)).rows[0].n;
const balance = async (mid: string) =>
  (await f.db.query<{ b: number }>('select coalesce(sum(amount), 0)::int as b from public.credit_ledger where membership_id = $1', [mid])).rows[0].b;
const gameRow = async (id: string) => (await f.db.query<{ number: number; session_id: string | null; started: boolean; finished: boolean; opponent: string | null }>(
  `select number, session_id, started_at is not null as started, finished_at is not null as finished, opponent
   from public.games where id = $1`, [id])).rows[0];
const audit = async (action: string) => (await f.db.query<{ details: Record<string, unknown> }>(
  'select details from public.audit_log where action = $1', [action])).rows;

beforeEach(async () => {
  f = await auctionFixture(8);
  keeper = await createUser(f.db, 'keeper@x.test');
  await makeKeeper(f.db, keeper);
  [alice, aliceM] = await member(f.db, 'alice');
  [, bobM] = await member(f.db, 'bob');
  for (const [mid, a] of [[aliceM, 0], [aliceM, 1], [bobM, 2], [bobM, 3]] as const) {
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 10, 'bid')`, [f.stage, mid, f.league, f.athletes[a]]);
  }
});

describe('delete_stage', () => {
  it('deletes the tournament, its games, stats sessions, rosters and bids, but keeps every credit (t121)', async () => {
    await grant(f);
    await openAuction(f);
    await bid(f, alice, aliceM, f.athletes[4], 5);
    const g1 = await open();
    const sid = await start(g1);
    await as(f.db, keeper, (tx) => rpc(tx, 'save_taps', {
      p_session: sid, p_client_now: new Date().toISOString(), p_taps: [tap(f.athletes[0], 'goal', new Date().toISOString())] }));
    await finish(g1);
    const before = [await balance(aliceM), await balance(bobM)];
    const ledger = await count('public.credit_ledger');
    expect(ledger).toBeGreaterThan(0);

    await as(f.db, f.admin, (tx) => rpc(tx, 'delete_stage', { p_stage: f.stage }));

    expect(await count('public.stages where id = $1', [f.stage])).toBe(0);
    expect(await count('public.games')).toBe(0);
    expect(await count('public.game_pairings')).toBe(0);
    expect(await count('public.sessions where id = $1', [sid])).toBe(0);
    expect(await count('public.stat_taps')).toBe(0);
    expect(await count('public.roster_slots')).toBe(0);
    expect(await count('public.bids')).toBe(0);
    expect(await count('public.credit_ledger')).toBe(ledger);
    expect(await count('public.credit_ledger where stage_id is not null')).toBe(0);
    expect([await balance(aliceM), await balance(bobM)]).toEqual(before);
    expect((await audit('delete_stage'))[0].details).toMatchObject({ name: 'Fall beta', games: 2, sessions: 1, slots: 4, bids: 1 });
  });

  it('is admin-only and needs a real tournament', async () => {
    await expect(as(f.db, keeper, (tx) => rpc(tx, 'delete_stage', { p_stage: f.stage }))).rejects.toThrow('FORBIDDEN');
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'delete_stage', { p_stage: crypto.randomUUID() }))).rejects.toThrow('NOT_FOUND');
  });
});

describe('reset_game', () => {
  it('undoes the newest started game: its stats and the next game go, and it can be played again (t121)', async () => {
    const g1 = await open();
    const sid = await start(g1);
    await as(f.db, keeper, (tx) => rpc(tx, 'save_taps', {
      p_session: sid, p_client_now: new Date().toISOString(), p_taps: [tap(f.athletes[0], 'goal', new Date().toISOString())] }));
    const g2 = await finish(g1);

    await reset(g1);

    expect(await gameRow(g1)).toMatchObject({ number: 1, session_id: null, started: false, finished: false });
    expect(await gameRow(g2)).toBeUndefined();
    expect(await count('public.sessions where id = $1', [sid])).toBe(0);
    expect(await count('public.game_pairings where game_id = $1', [g1])).toBe(1); // pairings kept
    expect((await audit('reset_game'))[0].details).toMatchObject({ number: 1, taps: 1, lines: 0, verified: false, next_game_deleted: true });
    await start(g1); // playable again
  });

  it('resets a live game that has no next game yet; undoing game 1 reopens bench choices', async () => {
    const g1 = await open();
    await start(g1);
    const setBench = () => as(f.db, alice, (tx) => rpc(tx, 'set_bench', { p_membership: aliceM, p_stage: f.stage, p_athletes: `{${f.athletes[0]}}` }));
    await expect(setBench()).rejects.toThrow('TOURNAMENT_STARTED');
    await reset(g1);
    expect(await gameRow(g1)).toMatchObject({ started: false });
    expect((await audit('reset_game'))[0].details).toMatchObject({ next_game_deleted: false });
    await setBench();
  });

  it('refuses an unstarted game, an older game, a non-admin and a missing game', async () => {
    const g1 = await open();
    await expect(reset(g1)).rejects.toThrow('GAME_NOT_STARTED');
    await start(g1);
    const g2 = await finish(g1);
    await start(g2);
    await expect(reset(g1)).rejects.toThrow('NOT_LATEST_GAME');
    await expect(reset(g2, keeper)).rejects.toThrow('FORBIDDEN');
    await expect(reset(crypto.randomUUID())).rejects.toThrow('NOT_FOUND');
    await reset(g2);
    await reset(g1); // newest first, one at a time
    expect(await gameRow(g1)).toMatchObject({ started: false });
  });
});

describe('set_game_opponent', () => {
  it('lets a keeper name a game any time; blank clears it (t123)', async () => {
    const g1 = await open();
    await name(g1, '  Duke ');
    expect((await gameRow(g1)).opponent).toBe('Duke');
    await start(g1);
    await name(g1, 'UNC', f.admin);
    expect((await gameRow(g1)).opponent).toBe('UNC');
    await name(g1, '   ');
    expect((await gameRow(g1)).opponent).toBeNull();
    expect((await audit('set_game_opponent')).map((r) => r.details.opponent)).toEqual(['Duke', 'UNC', null]);
  });

  it('refuses players, names over 40 characters and missing games', async () => {
    const g1 = await open();
    await expect(name(g1, 'Duke', alice)).rejects.toThrow('FORBIDDEN');
    await expect(name(g1, 'x'.repeat(41))).rejects.toThrow('INVALID_NAME');
    await expect(name(crypto.randomUUID(), 'Duke')).rejects.toThrow('NOT_FOUND');
  });
});
