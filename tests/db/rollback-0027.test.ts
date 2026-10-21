// The 0027 rollback file (outside migrations/) restores the retired player injury and attendance RPCs and drops outs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { statsFixture } from './stats-fixture';

describe('0027 rollback', () => {
  it('restores the old functions and removes outs', async () => {
    const f = await statsFixture();
    const player = await createUser(f.db, 'sam@x.test');
    await as(f.db, f.admin, (tx) => rpc(tx, 'link_athlete_user', { p_athlete: f.sam, p_user: player }));
    await f.db.exec(readFileSync(fileURLToPath(new URL('../../supabase/rollback/0027_out_down.sql', import.meta.url)), 'utf8'));

    const call = (who: string | null, fn: string, args: Record<string, unknown>) => as(f.db, who, (tx) => rpc(tx, fn, args));
    const iid = (await call(player, 'report_injury', { p_athlete: f.sam })) as string;
    await call(player, 'set_attendance', { p_session: f.session, p_athlete: f.sam, p_status: 'absent' });
    await call(f.k1, 'confirm_injury', { p_injury: iid });
    await call(player, 'clear_injury', { p_athlete: f.sam });
    const gone = await f.db.query<{ outs: string | null; set_out: string | null; clear_out: string | null }>(
      `select to_regclass('public.outs')::text as outs, to_regprocedure('public.set_out(uuid, uuid)')::text as set_out,
              to_regprocedure('public.clear_out(uuid, uuid)')::text as clear_out`);
    expect(gone.rows[0]).toEqual({ outs: null, set_out: null, clear_out: null });
    await expect(call(null, 'report_injury', { p_athlete: f.sam })).rejects.toThrow(/permission denied/);
  });
});
