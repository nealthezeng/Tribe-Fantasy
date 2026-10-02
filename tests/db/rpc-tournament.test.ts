import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, injure, member, type AuctionFixture } from './auction-fixture';
import { makeKeeper } from './stats-fixture';

let f: AuctionFixture;
let keeper: string;
let alice: string, aliceM: string, bob: string, bobM: string, carol: string, carolM: string;

/** carol has the bye: three teams in league A. */
const pairings = () => [
  { league_id: f.league, home: aliceM, away: bobM },
  { league_id: f.league, home: carolM, away: null },
];
const open = (p: unknown = pairings(), who = f.admin) =>
  as(f.db, who, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: p })) as Promise<string>;
const start = (game: string, who = keeper) => as(f.db, who, (tx) => rpc(tx, 'start_game', { p_game: game })) as Promise<string>;
const finish = (game: string, p: unknown = pairings(), who = keeper) =>
  as(f.db, who, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: p, p_provisional: { standings: 'x' } })) as Promise<string>;
const setPick = (uid: string, mid: string, number: number, athlete: string | null) =>
  as(f.db, uid, (tx) => rpc(tx, 'set_game_pick', { p_membership: mid, p_stage: f.stage, p_number: number, p_athlete: athlete }));
const setBench = (uid: string, mid: string, athletes: string[]) =>
  // A Postgres array literal: the rpc helper sends arrays as JSON (PostgREST converts them itself).
  as(f.db, uid, (tx) => rpc(tx, 'set_bench', { p_membership: mid, p_stage: f.stage, p_athletes: `{${athletes.join(',')}}` }));
const swap = (uid: string, mid: string, out: string, inn: string) =>
  as(f.db, uid, (tx) => rpc(tx, 'swap_bench', { p_membership: mid, p_stage: f.stage, p_out: out, p_in: inn }));
const game = async (number: number) => (await f.db.query<{ id: string; session_id: string | null; started: boolean; finished: boolean }>(
  `select id, session_id, started_at is not null as started, finished_at is not null as finished
   from public.games where stage_id = $1 and number = $2`, [f.stage, number])).rows[0];
const benchOf = async (mid: string) => (await f.db.query<{ athlete_id: string }>(
  `select athlete_id from public.roster_slots where membership_id = $1 and bench order by athlete_id`, [mid])).rows.map((r) => r.athlete_id);
const audit = async (action: string) => (await f.db.query<{ details: Record<string, unknown> }>(
  'select details from public.audit_log where action = $1', [action])).rows;

beforeEach(async () => {
  f = await auctionFixture(12);
  keeper = await createUser(f.db, 'keeper@x.test');
  await makeKeeper(f.db, keeper);
  [alice, aliceM] = await member(f.db, 'alice');
  [bob, bobM] = await member(f.db, 'bob');
  [carol, carolM] = await member(f.db, 'carol');
  // Rosters straight in (the auction is tested elsewhere): alice A0–A3 (A3 cheapest), bob A4–A7 (A4 cheapest),
  // carol A8 alone (no bench).
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
    await expect(as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: crypto.randomUUID(), p_pairings: [] })))
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

  it('fixes the default bench when game 1 starts, keeping a valid choice', async () => {
    const g1 = await open();
    await setBench(bob, bobM, [f.athletes[5]]);
    await start(g1);
    expect(await benchOf(aliceM)).toEqual([f.athletes[3]]); // cheapest
    expect(await benchOf(bobM)).toEqual([f.athletes[5]]); // chosen
    expect(await benchOf(carolM)).toEqual([]); // one athlete: no bench
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

  it('refuses to start a game while an earlier one is live', async () => {
    await open();
    await f.db.query(`insert into public.games (stage_id, number) values ($1, 2)`, [f.stage]);
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

  it('takes the next game only, even before that game exists', async () => {
    await expect(setPick(alice, aliceM, 2, f.athletes[0])).rejects.toThrow('NOT_NEXT_GAME');
    await start(await open());
    await setPick(alice, aliceM, 2, f.athletes[0]); // game 1 live, game 2 not created yet
    await expect(setPick(alice, aliceM, 3, f.athletes[0])).rejects.toThrow('NOT_NEXT_GAME');
    await expect(setPick(alice, aliceM, 0, f.athletes[0])).rejects.toThrow('PICK_LOCKED');
  });

  it('checks the roster and the membership, and null clears', async () => {
    await expect(setPick(alice, aliceM, 1, f.athletes[4])).rejects.toThrow('NOT_ON_ROSTER');
    await expect(setPick(bob, aliceM, 1, f.athletes[0])).rejects.toThrow('NOT_MEMBER');
    await setPick(alice, aliceM, 1, f.athletes[3]); // the bench is allowed: the scorer replaces it
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
});

describe('set_bench', () => {
  it('sets exactly the bench count of the roster', async () => {
    await setBench(alice, aliceM, [f.athletes[0]]);
    expect(await benchOf(aliceM)).toEqual([f.athletes[0]]);
    await setBench(alice, aliceM, [f.athletes[2]]);
    expect(await benchOf(aliceM)).toEqual([f.athletes[2]]);
    await expect(setBench(alice, aliceM, [])).rejects.toThrow('BENCH_SIZE');
    await expect(setBench(alice, aliceM, [f.athletes[0], f.athletes[1]])).rejects.toThrow('BENCH_SIZE');
    await expect(setBench(alice, aliceM, [f.athletes[0], f.athletes[0]])).rejects.toThrow('BENCH_SIZE');
    await expect(setBench(alice, aliceM, [f.athletes[4]])).rejects.toThrow('NOT_ON_ROSTER');
    await expect(setBench(bob, aliceM, [f.athletes[0]])).rejects.toThrow('NOT_MEMBER');
    await setBench(carol, carolM, []); // a one-athlete roster has no bench
    await as(f.db, carol, (tx) => rpc(tx, 'set_bench', { p_membership: carolM, p_stage: f.stage, p_athletes: null }));
    expect(await benchOf(carolM)).toEqual([]); // NULL means no bench too
  });

  it('refuses once the tournament has started', async () => {
    await start(await open());
    await expect(setBench(alice, aliceM, [f.athletes[0]])).rejects.toThrow('TOURNAMENT_STARTED');
  });
});

describe('swap_bench', () => {
  it('swaps the bench in for an injured active athlete from the next game, once per stage', async () => {
    await expect(swap(alice, aliceM, f.athletes[0], f.athletes[3])).rejects.toThrow('TOURNAMENT_NOT_STARTED');
    const g1 = await open();
    await start(g1); // alice's bench: A3 (default)
    await expect(swap(alice, aliceM, f.athletes[0], f.athletes[3])).rejects.toThrow('NOT_INJURED');
    await injure(f, f.athletes[0]);
    await expect(swap(alice, aliceM, f.athletes[3], f.athletes[0])).rejects.toThrow('NOT_ACTIVE');
    await expect(swap(alice, aliceM, f.athletes[0], f.athletes[1])).rejects.toThrow('NOT_ON_BENCH');
    await expect(swap(bob, aliceM, f.athletes[0], f.athletes[3])).rejects.toThrow('NOT_MEMBER');
    await swap(alice, aliceM, f.athletes[0], f.athletes[3]);
    const rows = await f.db.query('select out_athlete, in_athlete, from_game from public.bench_swaps');
    expect(rows.rows).toEqual([{ out_athlete: f.athletes[0], in_athlete: f.athletes[3], from_game: 2 }]);
    await injure(f, f.athletes[1]);
    await expect(swap(alice, aliceM, f.athletes[1], f.athletes[3])).rejects.toThrow('SWAP_USED');
  });
});

describe('deletes', () => {
  it('drops a deleted athlete\'s picks and swaps (cascade)', async () => {
    await setPick(alice, aliceM, 1, f.athletes[0]);
    await f.db.query('delete from public.athletes where id = $1', [f.athletes[0]]);
    expect((await f.db.query('select 1 from public.game_picks')).rows).toEqual([]);
  });
});
