import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin } from './helpers';

let db: PGlite;
let admin: string;
let alice: string;

beforeEach(async () => {
  db = await freshDb();
  admin = await createUser(db, 'admin@x.test');
  alice = await createUser(db, 'alice@x.test');
  await makeAdmin(db, admin);
  await db.exec(`
    insert into public.seasons (id, name) values ('00000000-0000-0000-0000-000000000001', 'Spring');
    insert into public.leagues (id, season_id, name) values ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'A');
    insert into public.invites (code, league_id) values ('ABC123', '00000000-0000-0000-0000-000000000002');
    insert into public.audit_log (action, entity) values ('seed', 'test');`);
});

describe('RLS', () => {
  it('lets signed-in users read seasons and leagues', async () => {
    const rows = await as(db, alice, async (tx) => (await tx.query('select name from public.seasons')).rows);
    expect(rows).toEqual([{ name: 'Spring' }]);
  });

  it('gives anon nothing', async () => {
    await expect(as(db, null, (tx) => tx.query('select * from public.seasons'))).rejects.toThrow(/permission denied/);
  });

  it('hides invites and the audit log from non-admins', async () => {
    const inv = await as(db, alice, async (tx) => (await tx.query('select * from public.invites')).rows);
    const log = await as(db, alice, async (tx) => (await tx.query('select * from public.audit_log')).rows);
    expect(inv).toEqual([]);
    expect(log).toEqual([]);
    const adminInv = await as(db, admin, async (tx) => (await tx.query('select code from public.invites')).rows);
    expect(adminInv).toEqual([{ code: 'ABC123' }]);
  });

  it('shows users only their own roles unless admin', async () => {
    const mine = await as(db, alice, async (tx) => (await tx.query('select * from public.user_roles')).rows);
    expect(mine).toEqual([]);
    const all = await as(db, admin, async (tx) => (await tx.query('select role from public.user_roles')).rows);
    expect(all).toEqual([{ role: 'admin' }]);
  });

  it('hides athletes and other profiles from accounts outside the league', async () => {
    await db.exec(`
      insert into public.profiles (id, display_name) values ('${admin}', 'Admin'), ('${alice}', 'Alice');
      insert into public.athletes (season_id, name) values ('00000000-0000-0000-0000-000000000001', 'Zed');`);
    const read = async () => as(db, alice, async (tx) => ({
      athletes: (await tx.query('select name from public.athletes')).rows,
      profiles: (await tx.query('select display_name from public.profiles order by display_name')).rows,
    }));
    expect(await read()).toEqual({ athletes: [], profiles: [{ display_name: 'Alice' }] });
    await db.query(`insert into public.memberships (league_id, user_id, team_name) values ('00000000-0000-0000-0000-000000000002', $1, 'Hucks')`, [alice]);
    expect(await read()).toEqual({ athletes: [{ name: 'Zed' }], profiles: [{ display_name: 'Admin' }, { display_name: 'Alice' }] });
  });

  it('lets staff with a role but no membership read roster data', async () => {
    await db.exec(`insert into public.athletes (season_id, name) values ('00000000-0000-0000-0000-000000000001', 'Zed');`);
    const rows = await as(db, admin, async (tx) => (await tx.query('select name from public.athletes')).rows);
    expect(rows).toEqual([{ name: 'Zed' }]);
  });

  it('rejects direct writes', async () => {
    await expect(as(db, admin, (tx) => tx.query(`insert into public.seasons (name) values ('Hack')`))).rejects.toThrow(/permission denied/);
  });
});
