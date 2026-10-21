import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { statsFixture, type StatsFixture } from './stats-fixture';

let f: StatsFixture;
let player: string;
const call = (who: string, fn: string, args: Record<string, unknown>) => as(f.db, who, (tx) => rpc(tx, fn, args));
const visibleInjuries = (who: string) =>
  as(f.db, who, async (tx) => (await tx.query('select athlete_id from public.injuries')).rows);

beforeEach(async () => {
  f = await statsFixture();
  player = await createUser(f.db, 'sam@x.test');
  await call(f.admin, 'link_athlete_user', { p_athlete: f.sam, p_user: player });
});

describe('link_athlete_user', () => {
  it('is admin-only and links one athlete per user per season', async () => {
    await expect(call(f.k1, 'link_athlete_user', { p_athlete: f.ali, p_user: player })).rejects.toThrow('FORBIDDEN');
    await expect(call(f.admin, 'link_athlete_user', { p_athlete: f.ali, p_user: player })).rejects.toThrow('USER_ALREADY_LINKED');
    await call(f.admin, 'link_athlete_user', { p_athlete: f.sam, p_user: null });
    await call(f.admin, 'link_athlete_user', { p_athlete: f.ali, p_user: player });
  });
});

describe('injuries (history)', () => {
  it('stay readable once cleared (M6: past games replay injuries); open ones need confirmation', async () => {
    const add = (sql: string) => f.db.query(`insert into public.injuries (athlete_id, reported_by, confirmed_at, cleared_at) values ($1, $2, ${sql})`, [f.sam, player]);
    await add('now(), now()');
    await add('null, null'); // an unconfirmed report is private to its player
    expect(await visibleInjuries(f.member)).toEqual([{ athlete_id: f.sam }]);
    expect(await visibleInjuries(player)).toEqual([{ athlete_id: f.sam }, { athlete_id: f.sam }]);
  });
});
