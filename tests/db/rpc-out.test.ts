// Out marks (0027): a player marked Out is swapped from game `from_game` on; set_out/clear_out are staff-only.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, member, type AuctionFixture } from './auction-fixture';
import { makeKeeper } from './stats-fixture';

let f: AuctionFixture;
let keeper: string;
let aliceM: string, bobM: string, carolM: string;

const pairings = () => [
  { league_id: f.league, home: aliceM, away: bobM },
  { league_id: f.league, home: carolM, away: null },
];
const open = (games: number) =>
  as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: pairings(), p_games: games })) as Promise<string>;
const start = (game: string) => as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game }));
const finish = (game: string) =>
  as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: pairings(), p_provisional: {} })) as Promise<string>;
const setOut = (athlete: string, who = keeper, stage = f.stage) =>
  as(f.db, who, (tx) => rpc(tx, 'set_out', { p_stage: stage, p_athlete: athlete })) as Promise<number>;
const clearOut = (athlete: string, who = keeper, stage = f.stage) =>
  as(f.db, who, (tx) => rpc(tx, 'clear_out', { p_stage: stage, p_athlete: athlete }));
/** [athlete, from_game, until_game] for every Out row. */
const outs = async () => (await f.db.query<{ athlete_id: string; from_game: number; until_game: number | null }>(
  'select athlete_id, from_game, until_game from public.outs order by from_game, set_at')).rows
  .map((r) => [r.athlete_id, r.from_game, r.until_game]);
const audit = async (action: string) => (await f.db.query<{ details: Record<string, unknown> }>(
  'select details from public.audit_log where action = $1 order by id', [action])).rows.map((r) => r.details);

beforeEach(async () => {
  f = await auctionFixture(3);
  keeper = await createUser(f.db, 'keeper@x.test');
  await makeKeeper(f.db, keeper);
  [, aliceM] = await member(f.db, 'alice');
  [, bobM] = await member(f.db, 'bob');
  [, carolM] = await member(f.db, 'carol');
});

describe('set_out', () => {
  it('marks a player out for the whole tournament before it starts', async () => {
    const [a0] = f.athletes;
    expect(await setOut(a0)).toBe(1);
    expect(await outs()).toEqual([[a0, 1, null]]);
    expect(await audit('set_out')).toEqual([{ athlete: a0, from_game: 1 }]);
    await open(2);
    expect(await setOut(f.athletes[1], f.admin)).toBe(1);
  });

  it('marks out from the next game while one is live', async () => {
    const [a0, a1] = f.athletes;
    const g1 = await open(3);
    await start(g1);
    expect(await setOut(a0)).toBe(2);
    const g2 = await finish(g1);
    await start(g2);
    expect(await setOut(a1)).toBe(3);
    expect(await outs()).toEqual([[a0, 2, null], [a1, 3, null]]);
  });

  it('is idempotent: a second mark keeps one open row and one audit row', async () => {
    const [a0] = f.athletes;
    const g1 = await open(3);
    expect(await setOut(a0)).toBe(1);
    await start(g1);
    expect(await setOut(a0)).toBe(1);
    expect(await outs()).toEqual([[a0, 1, null]]);
    expect(await audit('set_out')).toHaveLength(1);
  });

  it('marks again after a clear', async () => {
    const [a0] = f.athletes;
    const g1 = await open(3);
    await setOut(a0);
    await start(g1);
    await clearOut(a0);
    expect(await setOut(a0)).toBe(2);
    expect(await outs()).toEqual([[a0, 1, 2], [a0, 2, null]]);
  });

  it('refuses non-staff and other seasons, and writes nothing', async () => {
    const [a0] = f.athletes;
    const [dave] = await member(f.db, 'dave');
    await expect(setOut(a0, dave)).rejects.toThrow('FORBIDDEN');
    await expect(clearOut(a0, dave)).rejects.toThrow('FORBIDDEN');
    await expect(as(f.db, null, (tx) => rpc(tx, 'set_out', { p_stage: f.stage, p_athlete: a0 }))).rejects.toThrow();
    const other = (await as(f.db, f.admin, (tx) => rpc(tx, 'create_season', { p_name: 'Other', p_settings: {} }))) as string;
    const foreign = (await as(f.db, f.admin, (tx) => rpc(tx, 'add_athlete', { p_season: other, p_name: 'Far', p_user: null }))) as string;
    await expect(setOut(foreign)).rejects.toThrow('NOT_FOUND');
    await expect(setOut(a0, keeper, '00000000-0000-0000-0000-000000000000')).rejects.toThrow('NOT_FOUND');
    await expect(clearOut(foreign)).rejects.toThrow('NOT_FOUND');
    expect(await outs()).toEqual([]);
    expect(await audit('set_out')).toEqual([]);
  });
});

describe('clear_out', () => {
  it('deletes a mark that never covered a game', async () => {
    const [a0] = f.athletes;
    await setOut(a0);
    await clearOut(a0);
    expect(await outs()).toEqual([]);
    expect(await audit('clear_out')).toEqual([{ athlete: a0, from_game: 1, until_game: null }]);
  });

  it('ends a mark that covered a started game at the next game', async () => {
    const [a0] = f.athletes;
    const g1 = await open(3);
    await setOut(a0);
    await start(g1);
    await clearOut(a0);
    expect(await outs()).toEqual([[a0, 1, 2]]);
    expect(await audit('clear_out')).toEqual([{ athlete: a0, from_game: 1, until_game: 2 }]);
    const row = await f.db.query<{ cleared_by: string; cleared_at: string }>('select cleared_by, cleared_at from public.outs');
    expect(row.rows[0].cleared_by).toBe(keeper);
    expect(row.rows[0].cleared_at).not.toBeNull();
  });

  it('deletes a mark made for a later game that has not started', async () => {
    const [a0] = f.athletes;
    const g1 = await open(3);
    await start(g1);
    await setOut(a0); // from game 2
    await clearOut(a0);
    expect(await outs()).toEqual([]);
  });

  it('is a no-op for a player who is not out', async () => {
    await clearOut(f.athletes[0]);
    expect(await outs()).toEqual([]);
    expect(await audit('clear_out')).toEqual([]);
  });
});

describe('reading and cleanup', () => {
  it('lets league members read Out rows, but not signed-in users outside every league', async () => {
    await setOut(f.athletes[0]);
    const read = (who: string) => as(f.db, who, async (tx) => (await tx.query('select 1 from public.outs')).rows.length);
    const [erin] = await member(f.db, 'erin');
    expect(await read(erin)).toBe(1);
    expect(await read(await createUser(f.db, 'loner@x.test'))).toBe(0);
    await expect(as(f.db, erin, (tx) => tx.query('insert into public.outs (stage_id, athlete_id, from_game) values ($1, $2, 1)',
      [f.stage, f.athletes[1]]))).rejects.toThrow();
  });

  it('removes Out rows with their stage', async () => {
    await setOut(f.athletes[0]);
    await as(f.db, f.admin, (tx) => rpc(tx, 'delete_stage', { p_stage: f.stage }));
    expect(await outs()).toEqual([]);
  });

  it('retires the player injury and attendance RPCs', async () => {
    for (const sig of ['report_injury(uuid)', 'confirm_injury(uuid)', 'clear_injury(uuid)', 'set_attendance(uuid, uuid, text)']) {
      const r = await f.db.query<{ p: string | null }>(`select to_regprocedure('public.${sig}')::text as p`);
      expect(r.rows[0].p, sig).toBeNull();
    }
  });
});
