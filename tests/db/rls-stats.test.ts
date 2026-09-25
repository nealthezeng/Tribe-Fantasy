import { beforeEach, describe, expect, it } from 'vitest';
import { as, rpc } from './helpers';
import { statsFixture, tap, type StatsFixture } from './stats-fixture';

let f: StatsFixture;
const count = (who: string, table: string) =>
  as(f.db, who, async (tx) => (await tx.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n);

beforeEach(async () => {
  f = await statsFixture();
  const now = new Date().toISOString();
  await as(f.db, f.k1, (tx) => rpc(tx, 'save_taps', { p_session: f.session, p_client_now: now, p_taps: [tap(f.sam, 'goal', now)] }));
  await as(f.db, f.k2, (tx) =>
    rpc(tx, 'verify_session', { p_session: f.session, p_lines: [{ athlete_id: f.sam, stats: { goal: 1 } }] }),
  );
});

describe('stats RLS', () => {
  it('shows league members sessions, verified stat lines and attendance, but not taps', async () => {
    expect(await count(f.member, 'sessions')).toBe(1);
    expect(await count(f.member, 'stat_lines')).toBe(1);
    expect(await count(f.member, 'attendance')).toBe(1);
    expect(await count(f.member, 'stat_taps')).toBe(0);
  });

  it('shows keepers the tap log', async () => {
    expect(await count(f.k3, 'stat_taps')).toBe(1);
  });

  it('shows signed-in strangers nothing', async () => {
    for (const t of ['sessions', 'stat_lines', 'attendance', 'stat_taps', 'injuries']) {
      expect(await count(f.stranger, t)).toBe(0);
    }
  });

  it('lets a linked player who is in no league see their athlete and the season sessions', async () => {
    await as(f.db, f.admin, (tx) => rpc(tx, 'link_athlete_user', { p_athlete: f.ali, p_user: f.stranger }));
    const mine = await as(f.db, f.stranger, async (tx) => (await tx.query('select id from public.athletes')).rows);
    expect(mine).toEqual([{ id: f.ali }]);
    expect(await count(f.stranger, 'sessions')).toBe(1);
    expect(await count(f.stranger, 'stat_lines')).toBe(0);
  });

  it('enforces points_played >= 0 (M3 gate)', async () => {
    await expect(
      f.db.query(`update public.stat_lines set points_played = -1 where session_id = $1`, [f.session]),
    ).rejects.toThrow(/points_played/);
  });
});
