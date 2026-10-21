// Tournament game count (0026): games are created up front, finish pairs the next one, set_game_count changes the count.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, member, type AuctionFixture } from './auction-fixture';
import { makeKeeper } from './stats-fixture';

let f: AuctionFixture;
let keeper: string;
let aliceM: string, bobM: string, carolM: string;

/** carol has the bye: three teams in league A. */
const pairings = () => [
  { league_id: f.league, home: aliceM, away: bobM },
  { league_id: f.league, home: carolM, away: null },
];
const open = (games: number, who = f.admin) =>
  as(f.db, who, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: pairings(), p_games: games })) as Promise<string>;
const start = (game: string) => as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game }));
const finish = (game: string, p: unknown = pairings()) =>
  as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: p, p_provisional: {} })) as Promise<string | null>;
const setCount = (count: number, p?: unknown, who = f.admin) =>
  as(f.db, who, (tx) => rpc(tx, 'set_game_count', { p_stage: f.stage, p_count: count, ...(p ? { p_pairings: p } : {}) }));
const id = async (number: number) => (await f.db.query<{ id: string }>(
  'select id from public.games where stage_id = $1 and number = $2', [f.stage, number])).rows[0].id;
/** [number, paired] for every game of the stage. */
const games = async () => (await f.db.query<{ number: number; paired: boolean }>(
  `select number, exists (select 1 from public.game_pairings p where p.game_id = g.id) as paired
   from public.games g where stage_id = $1 order by number`, [f.stage])).rows.map((r) => [r.number, r.paired]);
const audit = async (action: string) => (await f.db.query<{ details: Record<string, unknown> }>(
  'select details from public.audit_log where action = $1 order by id', [action])).rows;
const mail = async (game: string) => (await f.db.query(
  `select 1 from private.outbox where kind = 'pick_next' and ref = $1`, [game])).rows.length;
const today = `(now() at time zone 'America/New_York')::date`;

beforeEach(async () => {
  f = await auctionFixture(8);
  keeper = await createUser(f.db, 'keeper@x.test');
  await makeKeeper(f.db, keeper);
  [, aliceM] = await member(f.db, 'alice');
  [, bobM] = await member(f.db, 'bob');
  [, carolM] = await member(f.db, 'carol');
  // One roster player each for alice and bob, so their pick mail is owed.
  for (const [mid, a] of [[aliceM, 0], [bobM, 1]] as const) {
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 10, 'bid')`, [f.stage, mid, f.league, f.athletes[a]]);
  }
});

describe('open_tournament with a game count', () => {
  it('opens with N games, pairing game 1 only', async () => {
    await open(3);
    expect(await games()).toEqual([[1, true], [2, false], [3, false]]);
    expect((await audit('open_tournament'))[0].details).toMatchObject({ games: 3 });
  });

  it('refuses a count outside 1–20, a missing one, and a non-admin', async () => {
    for (const n of [0, 21, -1]) await expect(open(n), String(n)).rejects.toThrow('GAME_COUNT_INVALID');
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: pairings(), p_games: null })))
      .rejects.toThrow('GAME_COUNT_INVALID');
    await expect(open(2, keeper)).rejects.toThrow('FORBIDDEN');
    expect(await games()).toEqual([]);
    await open(20);
    expect(await games()).toHaveLength(20);
  });
});

describe('finish_game', () => {
  it('pairs the next existing game; the last finish pairs nothing and ends the tournament', async () => {
    const g1 = await open(2);
    await start(g1);
    const g2 = await finish(g1);
    expect(g2).toBe(await id(2));
    expect(await games()).toEqual([[1, true], [2, true]]);
    await start(g2!);
    expect(await finish(g2!, [])).toBeNull();
    const done = await f.db.query<{ finished: boolean }>(
      'select finished_at is not null as finished from public.games where stage_id = $1', [f.stage]);
    expect(done.rows.every((r) => r.finished)).toBe(true);
    const log = await audit('finish_game');
    expect(log[0].details).toMatchObject({ next_game_id: g2, last: false });
    expect(log[1].details).toMatchObject({ next_game_id: null, last: true, pairings: null });
  });

  it('ignores pairings on the last game, and still checks them on a middle one', async () => {
    const g1 = await open(2);
    await start(g1);
    await expect(finish(g1, [])).rejects.toThrow('PAIRINGS_INVALID');
    const g2 = (await finish(g1))!;
    await start(g2);
    expect(await finish(g2, {})).toBeNull();
  });

  it('refuses pairing a game twice', async () => {
    const g1 = await open(2);
    await start(g1);
    await f.db.query(`insert into public.game_pairings (game_id, league_id, home, away) values ($1, $2, $3, $4)`,
      [await id(2), f.league, aliceM, bobM]);
    await expect(finish(g1)).rejects.toThrow('NEXT_GAME_EXISTS');
    expect((await f.db.query('select 1 from public.games where finished_at is not null')).rows).toEqual([]);
  });
});

describe('set_game_count', () => {
  it('lowers the count down to the newest started game, never below', async () => {
    const g1 = await open(4);
    await start(g1);
    await finish(g1);
    await start(await id(2));
    await expect(setCount(1)).rejects.toThrow('GAME_COUNT_INVALID');
    await setCount(2);
    expect(await games()).toEqual([[1, true], [2, true]]);
    expect((await audit('set_game_count'))[0].details).toMatchObject({ from: 4, to: 2 });
    // Game 2 is now the last game: finishing it ends the tournament without pairing anything.
    expect(await finish(await id(2), [])).toBeNull();
  });

  it('refuses a count outside 1–20', async () => {
    await open(3);
    for (const n of [0, 21]) await expect(setCount(n), String(n)).rejects.toThrow('GAME_COUNT_INVALID');
    expect(await games()).toHaveLength(3);
  });

  it('lowering away the paired next game deletes its pairings', async () => {
    const g1 = await open(3);
    await start(g1);
    await finish(g1);
    await setCount(1);
    expect(await games()).toEqual([[1, true]]);
    expect((await f.db.query('select 1 from public.game_pairings')).rows).toHaveLength(2); // game 1's only
  });

  it('raises the count; an over tournament needs the new game paired, within its dates', async () => {
    const g1 = await open(1);
    await start(g1);
    await finish(g1, []);
    await expect(setCount(2)).rejects.toThrow('PAIRINGS_INVALID');
    await expect(setCount(2, [{ league_id: f.league, home: aliceM, away: bobM }])).rejects.toThrow('PAIRINGS_INVALID');
    expect(await games()).toEqual([[1, true]]);
    await f.db.query(`update public.stages set starts_on = ${today} - 2, ends_on = ${today} - 1 where id = $1`, [f.stage]);
    await expect(setCount(2, pairings())).rejects.toThrow('TOURNAMENT_ENDED');
    await f.db.query(`update public.stages set ends_on = ${today} + 30 where id = $1`, [f.stage]);
    await setCount(3, pairings());
    expect(await games()).toEqual([[1, true], [2, true], [3, false]]);
    expect((await audit('set_game_count'))[0].details).toMatchObject({ from: 1, to: 3 });
  });

  it('raising a tournament still in play appends unpaired games and ignores pairings', async () => {
    await open(2);
    await setCount(4, {});
    expect(await games()).toEqual([[1, true], [2, false], [3, false], [4, false]]);
  });

  it('is admin only, refuses an unopened stage, audits {from, to}, no row for the same count', async () => {
    await expect(setCount(2)).rejects.toThrow('NOT_OPEN');
    await open(3);
    await expect(setCount(2, undefined, keeper)).rejects.toThrow('FORBIDDEN');
    await expect(as(f.db, null, (tx) => rpc(tx, 'set_game_count', { p_stage: f.stage, p_count: 2 }))).rejects.toThrow();
    expect(await games()).toHaveLength(3);
    expect(await audit('set_game_count')).toEqual([]);
    await setCount(3);
    expect(await audit('set_game_count')).toEqual([]);
    await setCount(2);
    expect((await audit('set_game_count')).map((r) => r.details)).toMatchObject([{ from: 3, to: 2 }]);
  });
});

describe('reset_game', () => {
  it('keeps the next game but unpairs it and clears its pick mail; a re-finish mails again', async () => {
    const g1 = await open(3);
    await start(g1);
    const g2 = (await finish(g1))!;
    await f.db.query('update public.games set opponent = $2 where id = $1', [g2, 'Duke']);
    expect(await mail(g2)).toBe(2);
    await as(f.db, f.admin, (tx) => rpc(tx, 'reset_game', { p_game: g1 }));
    expect(await games()).toEqual([[1, true], [2, false], [3, false]]);
    const row = await f.db.query<{ opponent: string }>('select opponent from public.games where id = $1', [g2]);
    expect(row.rows[0].opponent).toBe('Duke');
    expect(await mail(g2)).toBe(0);
    expect((await audit('reset_game'))[0].details).toMatchObject({ next_game_unpaired: true });
    await expect(start(g2)).rejects.toThrow('PREVIOUS_GAME_LIVE');
    await start(g1);
    expect(await finish(g1)).toBe(g2);
    expect(await mail(g2)).toBe(2);
  });
});
