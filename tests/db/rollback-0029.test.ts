// The 0029 rollback file (outside migrations/) restores 0024's list_leagues and drops close_share_buying.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { as, createUser, freshDb, makeAdmin, rpc } from './helpers';

describe('0029 rollback', () => {
  it('restores the 0024 list_leagues and drops close_share_buying', async () => {
    const db = await freshDb();
    const admin = await createUser(db, 'admin@x.test');
    await makeAdmin(db, admin);
    const call = (fn: string, args: Record<string, unknown>) => as(db, admin, (tx) => rpc(tx, fn, args));
    await call('set_display_name', { p_name: 'Admin' });
    await call('create_season', { p_name: 'Fall', p_settings: {} });
    const id = await call('create_my_league', { p_name: 'L', p_password: null, p_team_name: 'Zips' });
    await db.exec(readFileSync(fileURLToPath(new URL('../../supabase/rollback/0029_p9_down.sql', import.meta.url)), 'utf8'));

    const list = (who: string | null) => as(db, who, async (tx) => (await tx.query('select * from public.list_leagues()')).rows);
    expect(await list(admin)).toEqual([
      { id, name: 'L', teams: 1, max_teams: 12, has_password: false, is_member: true, is_creator: true },
    ]);
    const gone = await db.query<{ f: string | null }>(`select to_regprocedure('public.close_share_buying(uuid)')::text as f`);
    expect(gone.rows[0]).toEqual({ f: null });
    await expect(list(null)).rejects.toThrow(/permission denied/);
  });
});
