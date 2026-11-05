import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin, rpc } from './helpers';

let db: PGlite;
let admin: string, alice: string, bob: string;

const avatarOf = async (id: string) =>
  (await db.query<{ avatar: unknown }>('select avatar from public.profiles where id = $1', [id])).rows[0].avatar;
const audit = async (action: string) =>
  (await db.query<{ actor: string; details: Record<string, unknown> }>('select actor, details from public.audit_log where action = $1', [action])).rows;

beforeEach(async () => {
  db = await freshDb();
  admin = await createUser(db, 'admin@x.test');
  alice = await createUser(db, 'alice@x.test');
  bob = await createUser(db, 'bob@x.test');
  await makeAdmin(db, admin);
  await db.query(`insert into public.profiles (id, display_name) values ($1, 'Admin'), ($2, 'Alice'), ($3, 'Bob')`, [admin, alice, bob]);
}, 60_000);

describe('set_avatar', () => {
  it('saves your own avatar and audits it', async () => {
    await as(db, alice, (tx) => rpc(tx, 'set_avatar', { p_avatar: { hat: 'crown', pose: 'cheer' } }));
    expect(await avatarOf(alice)).toEqual({ hat: 'crown', pose: 'cheer' });
    expect((await audit('set_avatar')).map((r) => r.actor)).toEqual([alice]);
  });

  it('never touches another row', async () => {
    await as(db, alice, (tx) => rpc(tx, 'set_avatar', { p_avatar: { hat: 'crown' } }));
    expect(await avatarOf(bob)).toBeNull();
  });

  it('refuses anon', async () => {
    await expect(as(db, null, (tx) => rpc(tx, 'set_avatar', { p_avatar: { hat: 'crown' } }))).rejects.toThrow();
  });

  it('says NO_PROFILE without a profile', async () => {
    const nameless = await createUser(db, 'nameless@x.test');
    await expect(as(db, nameless, (tx) => rpc(tx, 'set_avatar', { p_avatar: { hat: 'crown' } }))).rejects.toThrow('NO_PROFILE');
  });

  it.each([
    ['null', null],
    ['an array', '[]'],
    ['a string', '"x"'],
    ['a number', '1'],
    ['a non-string value', { a: 1 }],
    ['a long value', { a: 'x'.repeat(25) }],
    ['a long key', { ['k'.repeat(25)]: 'x' }],
    ['too many keys', Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, 'x']))],
  ])('refuses %s with BAD_AVATAR', async (_label, value) => {
    await expect(as(db, alice, (tx) => rpc(tx, 'set_avatar', { p_avatar: value }))).rejects.toThrow('BAD_AVATAR');
  });

  it('accepts unknown part names: SQL does not know the part lists', async () => {
    await as(db, alice, (tx) => rpc(tx, 'set_avatar', { p_avatar: { hat: 'jetpack' } }));
    expect(await avatarOf(alice)).toEqual({ hat: 'jetpack' });
  });
});

describe('admin_reset_avatar', () => {
  it('sets null and audits the old value', async () => {
    await as(db, alice, (tx) => rpc(tx, 'set_avatar', { p_avatar: { hat: 'crown' } }));
    await as(db, admin, (tx) => rpc(tx, 'admin_reset_avatar', { p_user: alice }));
    expect(await avatarOf(alice)).toBeNull();
    expect((await audit('admin_reset_avatar'))[0].details).toEqual({ user: alice, old: { hat: 'crown' } });
  });

  it('refuses a non-admin', async () => {
    await expect(as(db, bob, (tx) => rpc(tx, 'admin_reset_avatar', { p_user: alice }))).rejects.toThrow('FORBIDDEN');
  });

  it('says NOT_FOUND for a missing profile', async () => {
    await expect(as(db, admin, (tx) => rpc(tx, 'admin_reset_avatar', { p_user: crypto.randomUUID() }))).rejects.toThrow('NOT_FOUND');
  });
});

describe('reading', () => {
  it("league members can read each other's avatar, others only their own", async () => {
    await as(db, alice, (tx) => rpc(tx, 'set_avatar', { p_avatar: { hat: 'crown' } }));
    const read = (uid: string) => as(db, uid, async (tx) =>
      (await tx.query<{ id: string }>('select id from public.profiles where avatar is not null')).rows.map((r) => r.id));
    expect(await read(bob)).toEqual([]);
    expect(await read(admin)).toEqual([alice]);
  });
});
