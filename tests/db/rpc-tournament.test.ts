import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, member, type AuctionFixture } from './auction-fixture';
import { makeKeeper } from './stats-fixture';

let f: AuctionFixture;
let keeper: string;
let alice: string, aliceM: string, bob: string, bobM: string, carolM: string;

/** carol has the bye: three teams in league A. */
const pairings = () => [
  { league_id: f.league, home: aliceM, away: bobM },
  { league_id: f.league, home: carolM, away: null },
];
const open = (p: unknown = pairings(), who = f.admin, games = 3) =>
  as(f.db, who, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: p, p_games: games })) as Promise<string>;
const start = (game: string, who = keeper) => as(f.db, who, (tx) => rpc(tx, 'start_game', { p_game: game })) as Promise<string>;
const finish = (game: string, p: unknown = pairings(), who = keeper) =>
  as(f.db, who, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: p, p_provisional: { standings: 'x' } })) as Promise<string>;
const finishLast = (game: string, who = keeper) =>
  as(f.db, who, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: [], p_provisional: {} })) as Promise<string | null>;
/** One athlete, or null to clear. A Postgres array literal: the rpc helper sends arrays as JSON (PostgREST converts them itself). */
const setPick = (uid: string, mid: string, number: number, athlete: string | null) =>
  as(f.db, uid, (tx) => rpc(tx, 'set_game_pick',
    { p_membership: mid, p_stage: f.stage, p_number: number, p_athletes: athlete && `{${athlete}}` }));
const game = async (number: number) => (await f.db.query<{ id: string; session_id: string | null; started: boolean; finished: boolean }>(
  `select id, session_id, started_at is not null as started, finished_at is not null as finished
   from public.games where stage_id = $1 and number = $2`, [f.stage, number])).rows[0];
const audit = async (action: string) => (await f.db.query<{ details: Record<string, unknown> }>(
  'select details from public.audit_log where action = $1', [action])).rows;

beforeEach(async () => {
  f = await auctionFixture(12);
  keeper = await createUser(f.db, 'keeper@x.test');
  await makeKeeper(f.db, keeper);
  [alice, aliceM] = await member(f.db, 'alice');
  [bob, bobM] = await member(f.db, 'bob');
  [, carolM] = await member(f.db, 'carol');
  // Rosters straight in (the auction is tested elsewhere): alice A0–A3, bob A4–A7, carol A8 alone.
  const rows: [string, number, number][] = [[aliceM, 0, 30], [aliceM, 1, 20], [aliceM, 2, 10], [aliceM, 3, 5],
    [bobM, 4, 1], [bobM, 5, 9], [bobM, 6, 9], [bobM, 7, 9], [carolM, 8, 50]];
  for (const [mid, a, price] of rows) {
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, $5, 'bid')`, [f.stage, mid, f.league, f.athletes[a], price]);
  }
});

describe('open_tournament', () => {
  it('creates game 1 with its pairings, once, and audits them', async () => {
    const id = await open();
    expect(await game(1)).toMatchObject({ id, session_id: null, started: false });
    const rows = await f.db.query('select home, away from public.game_pairings where game_id = $1 order by home', [id]);
    expect(rows.rows).toHaveLength(2);
    expect((await audit('open_tournament'))[0].details).toMatchObject({ game_id: id });
    await expect(open()).rejects.toThrow('GAMES_EXIST');
  });

  it('refuses pairings that miss, repeat or misplace a team, or give a league two byes', async () => {
    const other = (await as(f.db, f.admin, (tx) => rpc(tx, 'create_league', { p_season: f.season, p_name: 'League B' }))) as string;
    const bad = [
      null, {}, [1], [{ league_id: f.league, home: aliceM, away: bobM }],
      [...pairings(), { league_id: f.league, home: aliceM, away: null }],
      [{ league_id: f.league, home: aliceM, away: null }, { league_id: f.league, home: bobM, away: null },
        { league_id: f.league, home: carolM, away: null }],
      [{ league_id: other, home: aliceM, away: bobM }, { league_id: f.league, home: carolM, away: null }],
      [{ league_id: f.league, home: aliceM, away: aliceM }, { league_id: f.league, home: bobM, away: carolM }],
      [{ league_id: f.league, home: 'not-a-uuid', away: bobM }, { league_id: f.league, home: carolM, away: null }],
      [{ league_id: f.league, away: bobM }, { league_id: f.league, home: carolM, away: aliceM }],
    ];
    for (const p of bad) await expect(open(p), JSON.stringify(p)).rejects.toThrow('PAIRINGS_INVALID');
    expect(await game(1)).toBeUndefined();
  });

  it('is admin-only and needs a real stage', async () => {
    await expect(open(pairings(), keeper)).rejects.toThrow('FORBIDDEN');
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: crypto.randomUUID(), p_pairings: [], p_games: 2 })))
      .rejects.toThrow('NOT_FOUND');
  });
});

describe('start_game / finish_game', () => {
  it('starts a game: a counted tournament session, linked, once', async () => {
    const g1 = await open();
    const sid = await start(g1);
    expect(await game(1)).toMatchObject({ session_id: sid, started: true, finished: false });
    const s = await f.db.query<{ kind: string; counts: boolean; created_by: string }>('select kind, counts, created_by from public.sessions where id = $1', [sid]);
    expect(s.rows[0]).toEqual({ kind: 'tournament', counts: true, created_by: keeper });
    await expect(start(g1)).rejects.toThrow('GAME_STARTED');
    await expect(start(g1, alice)).rejects.toThrow('FORBIDDEN');
  });

  it('finishes a live game into the next one with the given pairings, auditing the provisional inputs', async () => {
    const g1 = await open();
    await expect(finish(g1)).rejects.toThrow('GAME_NOT_LIVE');
    await start(g1);
    const next = [{ league_id: f.league, home: aliceM, away: carolM }, { league_id: f.league, home: bobM, away: null }];
    await expect(finish(g1, [{ league_id: f.league, home: aliceM, away: bobM }])).rejects.toThrow('PAIRINGS_INVALID');
    const g2 = await finish(g1, next);
    expect(await game(1)).toMatchObject({ finished: true });
    expect(await game(2)).toMatchObject({ id: g2, started: false });
    expect((await audit('finish_game'))[0].details).toMatchObject({ next_game_id: g2, provisional: { standings: 'x' } });
    await expect(finish(g1)).rejects.toThrow('GAME_NOT_LIVE');
    await expect(finish(g2, pairings(), alice)).rejects.toThrow('FORBIDDEN');
  });

  it('finishes the last game without pairing anything', async () => {
    const g1 = await open(pairings(), f.admin, 1);
    await start(g1);
    expect(await finishLast(g1)).toBeNull();
    expect(await game(1)).toMatchObject({ finished: true });
    expect(await game(2)).toBeUndefined();
    expect((await audit('finish_game'))[0].details).toMatchObject({ last: true, next_game_id: null });
    await expect(finishLast(g1)).rejects.toThrow('GAME_NOT_LIVE');
  });

  it('refuses to start a game while an earlier one is live', async () => {
    await open();
    await start((await game(1)).id);
    await expect(start((await game(2)).id)).rejects.toThrow('PREVIOUS_GAME_LIVE');
  });

  it("leaves the game void (session_id null) when its session is deleted", async () => {
    const g1 = await open();
    const sid = await start(g1);
    await f.db.query('delete from public.sessions where id = $1', [sid]);
    expect(await game(1)).toMatchObject({ session_id: null, started: true });
  });
});

describe('set_game_pick', () => {
  it('pre-selects game 1 before the tournament opens, then locks it at the start', async () => {
    await setPick(alice, aliceM, 1, f.athletes[0]);
    await setPick(alice, aliceM, 1, f.athletes[1]);
    const g1 = await open();
    await start(g1);
    await expect(setPick(alice, aliceM, 1, f.athletes[2])).rejects.toThrow('PICK_LOCKED');
    const picks = await f.db.query<{ athlete_id: string }>('select athlete_id from public.game_picks where game_number = 1');
    expect(picks.rows).toEqual([{ athlete_id: f.athletes[1] }]);
  });

  it('takes the next game only', async () => {
    await expect(setPick(alice, aliceM, 2, f.athletes[0])).rejects.toThrow('NOT_NEXT_GAME');
    await start(await open());
    await setPick(alice, aliceM, 2, f.athletes[0]); // game 1 live, game 2 not paired yet
    await expect(setPick(alice, aliceM, 3, f.athletes[0])).rejects.toThrow('NOT_NEXT_GAME');
    await expect(setPick(alice, aliceM, 0, f.athletes[0])).rejects.toThrow('PICK_LOCKED');
  });

  it('checks the roster and the membership, and null clears', async () => {
    await expect(setPick(alice, aliceM, 1, f.athletes[4])).rejects.toThrow('NOT_ON_ROSTER');
    await expect(setPick(bob, aliceM, 1, f.athletes[0])).rejects.toThrow('NOT_MEMBER');
    await setPick(alice, aliceM, 1, f.athletes[3]);
    await setPick(alice, aliceM, 1, null);
    expect((await f.db.query('select 1 from public.game_picks')).rows).toEqual([]);
  });

  it('stays sealed from the league until its game starts', async () => {
    const visible = (uid: string) => as(f.db, uid, async (tx) =>
      (await tx.query<{ membership_id: string }>('select membership_id from public.game_picks')).rows.map((r) => r.membership_id));
    await setPick(alice, aliceM, 1, f.athletes[0]);
    expect(await visible(alice)).toEqual([aliceM]);
    expect(await visible(bob)).toEqual([]);
    expect(await visible(keeper)).toEqual([]);
    await start(await open());
    expect(await visible(bob)).toEqual([aliceM]);
    expect(await visible(keeper)).toEqual([aliceM]);
    const stranger = await createUser(f.db, 'stranger@x.test');
    expect(await visible(stranger)).toEqual([]);
  });

  it("keeps the next game's pick sealed while the current game is live", async () => {
    const g1 = await open();
    await setPick(alice, aliceM, 1, f.athletes[0]);
    await start(g1);
    await setPick(alice, aliceM, 2, f.athletes[1]);
    const seen = await as(f.db, bob, async (tx) => (await tx.query<{ game_number: number }>(
      'select game_number from public.game_picks where membership_id = $1 order by game_number', [aliceM])).rows);
    expect(seen).toEqual([{ game_number: 1 }]);
  });

  it('audits a pick without its athlete', async () => {
    await setPick(alice, aliceM, 1, f.athletes[0]);
    expect(JSON.stringify(await audit('set_game_pick'))).not.toContain(f.athletes[0]);
  });
});

describe('NOT_FOUND', () => {
  it('names a missing game or stage', async () => {
    const nope = crypto.randomUUID();
    await expect(start(nope)).rejects.toThrow('NOT_FOUND');
    await expect(finish(nope)).rejects.toThrow('NOT_FOUND');
    const calls: [string, Record<string, unknown>][] = [
      ['set_game_pick', { p_membership: aliceM, p_stage: nope, p_number: 1, p_athletes: `{${f.athletes[0]}}` }],
    ];
    for (const [fn, args] of calls) await expect(as(f.db, alice, (tx) => rpc(tx, fn, args)), fn).rejects.toThrow('NOT_FOUND');
  });
});

describe('deletes', () => {
  it('drops a deleted athlete\'s picks (cascade)', async () => {
    await setPick(alice, aliceM, 1, f.athletes[0]);
    await f.db.query('delete from public.athletes where id = $1', [f.athletes[0]]);
    expect((await f.db.query('select 1 from public.game_picks')).rows).toEqual([]);
  });
});
