import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { backdateVerify, statsFixture, type StatsFixture } from './stats-fixture';

let f: StatsFixture;
let player: string;
const call = (who: string, fn: string, args: Record<string, unknown>) => as(f.db, who, (tx) => rpc(tx, fn, args));
const attend = (who: string, athlete: string, status: string) =>
  call(who, 'set_attendance', { p_session: f.session, p_athlete: athlete, p_status: status });
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

describe('set_attendance', () => {
  it('lets a player set only their own attendance, and keepers set anyone’s', async () => {
    await attend(player, f.sam, 'absent');
    await expect(attend(player, f.ali, 'present')).rejects.toThrow('NOT_YOUR_ATHLETE');
    await attend(f.k1, f.ali, 'present');
    const rows = await f.db.query(`select athlete_id, status from public.attendance order by status`);
    expect(rows.rows).toEqual([
      { athlete_id: f.sam, status: 'absent' },
      { athlete_id: f.ali, status: 'present' },
    ]);
    const mine = await as(f.db, player, async (tx) => (await tx.query('select athlete_id from public.attendance')).rows);
    expect(mine).toEqual([{ athlete_id: f.sam }]);
  });

  it('rejects bad statuses and locked sessions', async () => {
    await expect(attend(player, f.sam, 'maybe')).rejects.toThrow('INVALID_STATUS');
    await call(f.k2, 'verify_session', { p_session: f.session, p_lines: [] });
    await backdateVerify(f.db, f.session, 49);
    await expect(attend(player, f.sam, 'present')).rejects.toThrow('SESSION_LOCKED');
  });
});

describe('injuries', () => {
  it('keeps a player report private until a keeper confirms it', async () => {
    const id = await call(player, 'report_injury', { p_athlete: f.sam });
    expect(await call(player, 'report_injury', { p_athlete: f.sam })).toBe(id);
    expect(await visibleInjuries(player)).toEqual([{ athlete_id: f.sam }]);
    expect(await visibleInjuries(f.member)).toEqual([]);
    await expect(call(f.member, 'confirm_injury', { p_injury: id })).rejects.toThrow('FORBIDDEN');
    await call(f.k1, 'confirm_injury', { p_injury: id });
    expect(await visibleInjuries(f.member)).toEqual([{ athlete_id: f.sam }]);
  });

  it('auto-confirms a keeper report, and lets the player clear it', async () => {
    await call(f.k1, 'report_injury', { p_athlete: f.sam });
    expect(await visibleInjuries(f.member)).toEqual([{ athlete_id: f.sam }]);
    await call(player, 'clear_injury', { p_athlete: f.sam });
    expect(await visibleInjuries(f.member)).toEqual([]);
    await expect(call(player, 'clear_injury', { p_athlete: f.sam })).rejects.toThrow('NOT_FOUND');
  });

  it('stops members reporting or clearing other athletes', async () => {
    await expect(call(f.member, 'report_injury', { p_athlete: f.sam })).rejects.toThrow('NOT_YOUR_ATHLETE');
    await call(f.k1, 'report_injury', { p_athlete: f.ali });
    await expect(call(player, 'clear_injury', { p_athlete: f.ali })).rejects.toThrow('NOT_YOUR_ATHLETE');
  });
});
