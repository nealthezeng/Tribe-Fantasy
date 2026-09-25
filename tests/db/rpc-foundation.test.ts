import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin, rpc } from './helpers';

let db: PGlite;
let admin: string;
let alice: string;
let bob: string;

async function setupLeague(code = 'ABC123', maxUses = 50, expiresAt: string | null = null) {
  return as(db, admin, async (tx) => {
    const season = (await rpc(tx, 'create_season', { p_name: 'Spring 2027', p_settings: {} })) as string;
    const league = (await rpc(tx, 'create_league', { p_season: season, p_name: 'League A' })) as string;
    await rpc(tx, 'create_invite', { p_league: league, p_code: code, p_max_uses: maxUses, p_expires_at: expiresAt });
    return { season, league };
  });
}
const named = (id: string, name: string) => as(db, id, (tx) => rpc(tx, 'set_display_name', { p_name: name }));

beforeEach(async () => {
  db = await freshDb();
  admin = await createUser(db, 'admin@x.test');
  alice = await createUser(db, 'alice@x.test');
  bob = await createUser(db, 'bob@x.test');
  await makeAdmin(db, admin);
});

describe('admin RPCs', () => {
  it('rejects non-admins and anon', async () => {
    await expect(as(db, alice, (tx) => rpc(tx, 'create_season', { p_name: 'X', p_settings: {} }))).rejects.toThrow('FORBIDDEN');
    await expect(as(db, null, (tx) => rpc(tx, 'create_season', { p_name: 'X', p_settings: {} }))).rejects.toThrow(/permission denied/);
  });

  it('creates a season and writes an audit row', async () => {
    const { season } = await setupLeague();
    const log = await db.query<{ action: string; actor: string }>(
      `select action, actor from public.audit_log where entity_id = $1`, [season]);
    expect(log.rows).toEqual([{ action: 'create_season', actor: admin }]);
  });

  it('validates settings shape and names', async () => {
    await expect(as(db, admin, (tx) => rpc(tx, 'create_season', { p_name: 'X', p_settings: [1] }))).rejects.toThrow('INVALID_SETTINGS');
    await expect(as(db, admin, (tx) => rpc(tx, 'create_season', { p_name: '   ', p_settings: {} }))).rejects.toThrow('INVALID_NAME');
  });

  it('updates settings and logs old and new values', async () => {
    const { season } = await setupLeague();
    await as(db, admin, (tx) => rpc(tx, 'update_season_settings', { p_season: season, p_settings: { roster_size: 6 } }));
    const row = await db.query<{ settings: { roster_size: number } }>(`select settings from public.seasons where id = $1`, [season]);
    expect(row.rows[0].settings.roster_size).toBe(6);
    const log = await db.query<{ details: { old: unknown; new: unknown } }>(
      `select details from public.audit_log where action = 'update_season_settings'`);
    expect(log.rows[0].details).toEqual({ old: {}, new: { roster_size: 6 } });
  });

  it('normalizes invite codes and rejects bad or duplicate ones', async () => {
    const { league } = await setupLeague();
    const code = await as(db, admin, (tx) => rpc(tx, 'create_invite', { p_league: league, p_code: ' team2027 ', p_max_uses: 5, p_expires_at: null }));
    expect(code).toBe('TEAM2027');
    await expect(as(db, admin, (tx) => rpc(tx, 'create_invite', { p_league: league, p_code: 'team2027', p_max_uses: 5, p_expires_at: null }))).rejects.toThrow('CODE_TAKEN');
    await expect(as(db, admin, (tx) => rpc(tx, 'create_invite', { p_league: league, p_code: 'no!', p_max_uses: 5, p_expires_at: null }))).rejects.toThrow('INVALID_CODE');
  });

  it('adds athletes once per season and toggles opt-in', async () => {
    const { season } = await setupLeague();
    const id = (await as(db, admin, (tx) => rpc(tx, 'add_athlete', { p_season: season, p_name: 'Sam', p_user: null }))) as string;
    await expect(as(db, admin, (tx) => rpc(tx, 'add_athlete', { p_season: season, p_name: 'Sam', p_user: null }))).rejects.toThrow('ATHLETE_EXISTS');
    await as(db, admin, (tx) => rpc(tx, 'set_athlete_opt_in', { p_athlete: id, p_opted_in: false }));
    const row = await db.query<{ opted_in: boolean }>(`select opted_in from public.athletes where id = $1`, [id]);
    expect(row.rows[0].opted_in).toBe(false);
  });

  it('refuses to remove the last admin', async () => {
    await expect(as(db, admin, (tx) => rpc(tx, 'revoke_role', { p_user: admin, p_role: 'admin' }))).rejects.toThrow('LAST_ADMIN');
    await as(db, admin, (tx) => rpc(tx, 'grant_role', { p_user: alice, p_role: 'admin' }));
    await as(db, admin, (tx) => rpc(tx, 'revoke_role', { p_user: admin, p_role: 'admin' }));
    await expect(as(db, admin, (tx) => rpc(tx, 'create_season', { p_name: 'X', p_settings: {} }))).rejects.toThrow('FORBIDDEN');
  });
});

describe('join_league', () => {
  it('requires a display name first', async () => {
    await setupLeague();
    await expect(as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'ABC123', p_team_name: 'Hucks' }))).rejects.toThrow('NO_PROFILE');
  });

  it('joins with a messy, lowercase code and counts the use', async () => {
    await setupLeague();
    await named(alice, 'Alice');
    const id = await as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: ' abc123 ', p_team_name: 'Hucks' }));
    expect(typeof id).toBe('string');
    const inv = await db.query<{ uses: number }>(`select uses from public.invites where code = 'ABC123'`);
    expect(inv.rows[0].uses).toBe(1);
  });

  it('rejects joining twice and duplicate team names', async () => {
    await setupLeague();
    await named(alice, 'Alice');
    await named(bob, 'Bob');
    await as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'ABC123', p_team_name: 'Hucks' }));
    await expect(as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'ABC123', p_team_name: 'Other' }))).rejects.toThrow('ALREADY_MEMBER');
    await expect(as(db, bob, (tx) => rpc(tx, 'join_league', { p_code: 'ABC123', p_team_name: 'Hucks' }))).rejects.toThrow('TEAM_NAME_TAKEN');
  });

  it('rejects unknown, expired and used-up invites', async () => {
    await setupLeague('ONEUSE1', 1);
    await named(alice, 'Alice');
    await named(bob, 'Bob');
    await expect(as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'NOPE99', p_team_name: 'Hucks' }))).rejects.toThrow('INVALID_INVITE');
    await as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'ONEUSE1', p_team_name: 'Hucks' }));
    await expect(as(db, bob, (tx) => rpc(tx, 'join_league', { p_code: 'ONEUSE1', p_team_name: 'Zips' }))).rejects.toThrow('INVALID_INVITE');
    await setupLeague('OLDONE1', 5, '2020-01-01T00:00:00Z');
    await expect(as(db, bob, (tx) => rpc(tx, 'join_league', { p_code: 'OLDONE1', p_team_name: 'Zips' }))).rejects.toThrow('INVALID_INVITE');
  });
});
