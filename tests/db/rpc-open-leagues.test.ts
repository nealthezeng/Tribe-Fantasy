// t215: anyone signed in creates or joins a league of the current season; public or password; creator + admins manage.
import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin, rpc } from './helpers';

let db: PGlite;
let admin: string, alice: string, bob: string, carol: string, season: string;

interface Listed { id: string; name: string; teams: number; max_teams: number; has_password: boolean; is_member: boolean; is_creator: boolean }

const call = (who: string, fn: string, args: Record<string, unknown>) => as(db, who, (tx) => rpc(tx, fn, args));
const create = (who: string, name: string, password: string | null = null, team = `${name} team`) =>
  call(who, 'create_my_league', { p_name: name, p_password: password, p_team_name: team }) as Promise<string>;
const join = (who: string, league: string, password: string | null = null, team = 'Hucks') =>
  call(who, 'join_open_league', { p_league: league, p_password: password, p_team_name: team }) as Promise<string>;
const list = (who: string) => as(db, who, async (tx) => (await tx.query<Listed>('select * from public.list_leagues()')).rows);
const user = async (email: string, name: string) => {
  const id = await createUser(db, email);
  await call(id, 'set_display_name', { p_name: name });
  return id;
};

beforeEach(async () => {
  db = await freshDb();
  admin = await user('admin@x.test', 'Admin');
  await makeAdmin(db, admin);
  alice = await user('alice@x.test', 'Alice');
  bob = await user('bob@x.test', 'Bob');
  carol = await user('carol@x.test', 'Carol');
  season = (await call(admin, 'create_season', { p_name: 'Fall', p_settings: {} })) as string;
});

describe('create_my_league', () => {
  it('creates a league in the current season with the creator as its first team, and audits no password', async () => {
    const id = await create(alice, ' Huck Yeah ', 'secret1', ' Zips ');
    const l = await db.query<{ season_id: string; name: string; created_by: string }>('select * from public.leagues where id = $1', [id]);
    expect(l.rows[0]).toMatchObject({ season_id: season, name: 'Huck Yeah', created_by: alice });
    const m = await db.query<{ user_id: string; team_name: string }>('select user_id, team_name from public.memberships where league_id = $1', [id]);
    expect(m.rows).toEqual([{ user_id: alice, team_name: 'Zips' }]);
    const a = await db.query<{ details: Record<string, unknown> }>(`select details from public.audit_log where action = 'create_my_league'`);
    expect(a.rows[0].details).toEqual({ season_id: season, name: 'Huck Yeah', team_name: 'Zips', has_password: true });
    expect(JSON.stringify(a.rows[0].details)).not.toContain('secret1');
  });

  it('stores only a bcrypt hash, out of reach of signed-in users', async () => {
    const id = await create(alice, 'Locked', 'secret1');
    const h = await db.query<{ hash: string }>('select hash from private.league_passwords where league_id = $1', [id]);
    expect(h.rows[0].hash).toMatch(/^\$2a\$/);
    await expect(as(db, alice, (tx) => tx.query('select * from private.league_passwords'))).rejects.toThrow(/permission denied/);
  });

  it('treats a blank password as a public league', async () => {
    const id = await create(alice, 'Open', '   ');
    expect((await db.query('select 1 from private.league_passwords where league_id = $1', [id])).rows).toHaveLength(0);
  });

  it('refuses bad input, no profile, no season, and duplicates', async () => {
    const nobody = await createUser(db, 'nobody@x.test');
    await expect(create(nobody, 'X')).rejects.toThrow('NO_PROFILE');
    await expect(create(alice, '   ')).rejects.toThrow('INVALID_NAME');
    await expect(create(alice, 'X', 'abc')).rejects.toThrow('INVALID_PASSWORD');
    await expect(create(alice, 'X', 'x'.repeat(41))).rejects.toThrow('INVALID_PASSWORD');
    await expect(create(alice, 'X', null, ' ')).rejects.toThrow('INVALID_TEAM_NAME');
    await create(alice, 'Taken');
    await expect(create(bob, 'Taken')).rejects.toThrow('LEAGUE_EXISTS');
    await db.query('delete from public.seasons');
    await expect(create(carol, 'Y')).rejects.toThrow('NO_SEASON');
  });

  it('allows one created league per person per season, freed by deleting it; admins are exempt', async () => {
    const first = await create(alice, 'One');
    await expect(create(alice, 'Two')).rejects.toThrow('CREATE_LIMIT');
    await call(alice, 'delete_league', { p_league: first });
    await create(alice, 'Two');
    await create(admin, 'A1');
    await create(admin, 'A2');
    // A new season starts the count again.
    await call(admin, 'create_season', { p_name: 'Spring', p_settings: {} });
    await create(alice, 'Spring league');
  });
});

describe('list_leagues', () => {
  it("lists the current season's leagues by name with counts, lock and my flags", async () => {
    const open = await create(alice, 'Bravo');
    const locked = await create(bob, 'Alpha', 'secret1');
    await join(carol, open);
    expect(await list(carol)).toEqual([
      { id: locked, name: 'Alpha', teams: 1, max_teams: 6, has_password: true, is_member: false, is_creator: false },
      { id: open, name: 'Bravo', teams: 2, max_teams: 6, has_password: false, is_member: true, is_creator: false },
    ]);
    expect((await list(alice)).find((l) => l.id === open)).toMatchObject({ is_member: true, is_creator: true });
  });

  it("uses the season's max_members and hides older seasons' leagues", async () => {
    await create(alice, 'Old');
    await call(admin, 'create_season', { p_name: 'Spring', p_settings: { max_members: 8 } });
    expect(await list(bob)).toEqual([]);
    await create(bob, 'New');
    expect((await list(bob))[0]).toMatchObject({ name: 'New', max_teams: 8 });
  });

  it('is closed to anon', async () => {
    await expect(as(db, null, (tx) => tx.query('select * from public.list_leagues()'))).rejects.toThrow(/permission denied/);
  });
});

describe('join_open_league', () => {
  it('joins a public league whatever password is sent, and audits without it', async () => {
    const id = await create(alice, 'Open');
    const mid = await join(bob, id, 'anything', ' Bobcats ');
    const m = await db.query<{ league_id: string; team_name: string }>('select league_id, team_name from public.memberships where id = $1', [mid]);
    expect(m.rows[0]).toEqual({ league_id: id, team_name: 'Bobcats' });
    const a = await db.query<{ details: Record<string, unknown> }>(`select details from public.audit_log where action = 'join_open_league'`);
    expect(a.rows[0].details).toEqual({ league_id: id, team_name: 'Bobcats' });
  });

  it('checks the password (trimmed) on a locked league', async () => {
    const id = await create(alice, 'Locked', 'secret1');
    await expect(join(bob, id, null)).rejects.toThrow('WRONG_PASSWORD');
    await expect(join(bob, id, 'Secret1')).rejects.toThrow('WRONG_PASSWORD');
    await join(bob, id, ' secret1 ');
  });

  it('says ALREADY_MEMBER and LEAGUE_FULL before asking for the password', async () => {
    await call(admin, 'update_season_settings', { p_season: season, p_settings: { max_members: 2 } });
    const id = await create(alice, 'Small', 'secret1');
    await expect(join(alice, id, 'wrong!')).rejects.toThrow('ALREADY_MEMBER');
    await join(bob, id, 'secret1');
    await expect(join(carol, id, 'wrong!')).rejects.toThrow('LEAGUE_FULL');
  });

  it('refuses a taken team name, no profile, bad team name, unknown or old-season leagues', async () => {
    const id = await create(alice, 'Open', null, 'Zips');
    await expect(join(bob, id, null, 'Zips')).rejects.toThrow('TEAM_NAME_TAKEN');
    await expect(join(bob, id, null, ' ')).rejects.toThrow('INVALID_TEAM_NAME');
    const nobody = await createUser(db, 'nobody@x.test');
    await expect(join(nobody, id)).rejects.toThrow('NO_PROFILE');
    await expect(join(bob, '00000000-0000-0000-0000-000000000000')).rejects.toThrow('NOT_FOUND');
    await call(admin, 'create_season', { p_name: 'Spring', p_settings: {} });
    await expect(join(bob, id)).rejects.toThrow('NOT_FOUND');
  });
});

describe('rename_league / set_league_password', () => {
  it('lets the creator and admins rename and change the password, nobody else', async () => {
    const id = await create(alice, 'Mine', 'secret1');
    await call(alice, 'rename_league', { p_league: id, p_name: 'Ours' });
    await call(admin, 'rename_league', { p_league: id, p_name: 'Theirs' });
    await expect(call(bob, 'rename_league', { p_league: id, p_name: 'Bobs' })).rejects.toThrow('NOT_LEAGUE_OWNER');
    await expect(call(bob, 'set_league_password', { p_league: id, p_password: null })).rejects.toThrow('NOT_LEAGUE_OWNER');
    expect((await list(alice))[0].name).toBe('Theirs');

    await call(alice, 'set_league_password', { p_league: id, p_password: 'newpass' });
    await expect(join(bob, id, 'secret1')).rejects.toThrow('WRONG_PASSWORD');
    await call(admin, 'set_league_password', { p_league: id, p_password: '' });
    expect((await list(bob))[0].has_password).toBe(false);
    await join(bob, id, null);

    const a = await db.query<{ details: unknown }>(`select details from public.audit_log where action = 'set_league_password'`);
    expect(JSON.stringify(a.rows)).not.toContain('newpass');
  });

  it('refuses a duplicate name, a short password, unknown leagues, and non-admins on old leagues', async () => {
    const id = await create(alice, 'Mine');
    await create(bob, 'Other');
    await expect(call(alice, 'rename_league', { p_league: id, p_name: 'Other' })).rejects.toThrow('LEAGUE_EXISTS');
    await expect(call(alice, 'set_league_password', { p_league: id, p_password: 'abc' })).rejects.toThrow('INVALID_PASSWORD');
    await expect(call(alice, 'rename_league', { p_league: '00000000-0000-0000-0000-000000000000', p_name: 'X' }))
      .rejects.toThrow('NOT_FOUND');
    const old = (await call(admin, 'create_league', { p_season: season, p_name: 'Legacy' })) as string;
    await expect(call(alice, 'rename_league', { p_league: old, p_name: 'X' })).rejects.toThrow('NOT_LEAGUE_OWNER');
  });
});

describe('leagues made before 0019', () => {
  it('list as public with no creator, anyone can join, and only an admin can lock them', async () => {
    const old = (await call(admin, 'create_league', { p_season: season, p_name: 'League A' })) as string;
    expect((await list(alice))[0]).toMatchObject({ id: old, has_password: false, is_creator: false, teams: 0 });
    await join(alice, old);
    await expect(call(alice, 'set_league_password', { p_league: old, p_password: 'secret1' })).rejects.toThrow('NOT_LEAGUE_OWNER');
    await call(admin, 'set_league_password', { p_league: old, p_password: 'secret1' });
    await expect(join(bob, old)).rejects.toThrow('WRONG_PASSWORD');
  });

  it('trims the password when it is set, so the same password works at join', async () => {
    const id = await create(alice, 'Spaced', '  secret1  ');
    await join(bob, id, 'secret1');
  });
});

describe('delete_league', () => {
  it('lets the creator delete only while theirs is the only team; admins delete any and audit counts', async () => {
    const id = await create(alice, 'Mine');
    await join(bob, id);
    await expect(call(alice, 'delete_league', { p_league: id })).rejects.toThrow('LEAGUE_HAS_TEAMS');
    await expect(call(carol, 'delete_league', { p_league: id })).rejects.toThrow('NOT_LEAGUE_OWNER');
    await call(admin, 'delete_league', { p_league: id });
    expect((await db.query('select 1 from public.memberships')).rows).toHaveLength(0);
    const a = await db.query<{ details: Record<string, unknown> }>(`select details from public.audit_log where action = 'delete_league'`);
    expect(a.rows[0].details).toEqual({ name: 'Mine', memberships: 2, ledger_rows: 0 });
  });

  it('refuses a league with donation records, even for admins', async () => {
    await call(admin, 'update_season_settings', { p_season: season, p_settings: { donations_enabled: true } });
    const id = await create(alice, 'Mine');
    const mid = (await db.query<{ id: string }>('select id from public.memberships where league_id = $1', [id])).rows[0].id;
    await call(admin, 'record_donation', { p_membership: mid, p_dollars: 5, p_note: null });
    await expect(call(alice, 'delete_league', { p_league: id })).rejects.toThrow('LEAGUE_HAS_DONATIONS');
    await expect(call(admin, 'delete_league', { p_league: id })).rejects.toThrow('LEAGUE_HAS_DONATIONS');
  });
});
