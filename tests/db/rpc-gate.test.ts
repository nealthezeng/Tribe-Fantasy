// M3 gate from the M1+M2 reviews: every staff RPC refuses non-staff, and every RPC writes an audit row.
// Both lists are discovered from pg_proc, so a new RPC without an entry below fails this file.
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin, rpc } from './helpers';
import { makeKeeper, tap } from './stats-fixture';

/** Read-only helpers used by RLS policies; they write nothing, so no audit row. */
const READ_HELPERS = ['can_read_league_data', 'has_role', 'is_admin', 'is_keeper', 'is_my_athlete', 'is_season_athlete'];
/** Any signed-in user may call these; they check ownership instead of a role. */
const MEMBER_CALLABLE = ['clear_injury', 'join_league', 'report_injury', 'set_attendance', 'set_display_name'];
/** Keepers (and admins) may call these; every other staff RPC is admin-only. */
const KEEPER_CALLABLE = ['confirm_injury', 'create_session', 'reopen_session', 'save_taps', 'verify_session'];

let db: PGlite;
let fns: { name: string; nargs: number }[];
let admin: string, keeper: string, verifier: string, player: string;

beforeAll(async () => {
  db = await freshDb();
  admin = await createUser(db, 'admin@x.test');
  keeper = await createUser(db, 'keeper@x.test');
  verifier = await createUser(db, 'verifier@x.test');
  player = await createUser(db, 'player@x.test');
  await makeAdmin(db, admin);
  await makeKeeper(db, verifier);
  const res = await db.query<{ name: string; nargs: number }>(`
    select p.proname as name, p.pronargs as nargs from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`);
  fns = res.rows;
});

const callNulls = (who: string, f: { name: string; nargs: number }) =>
  as(db, who, (tx) => tx.query(`select public.${f.name}(${Array(f.nargs).fill('null').join(', ')})`));

describe('RPC gate', () => {
  it('refuses every staff RPC for a signed-in user with no role', async () => {
    const staff = fns.filter((f) => !READ_HELPERS.includes(f.name) && !MEMBER_CALLABLE.includes(f.name));
    expect(staff.length).toBeGreaterThanOrEqual(15);
    for (const f of staff) await expect(callNulls(player, f), f.name).rejects.toThrow('FORBIDDEN');
  });

  it('refuses every admin-only RPC for a stat keeper', async () => {
    const adminOnly = fns.filter(
      (f) => ![...READ_HELPERS, ...MEMBER_CALLABLE, ...KEEPER_CALLABLE].includes(f.name),
    );
    for (const f of adminOnly) await expect(callNulls(verifier, f), f.name).rejects.toThrow('FORBIDDEN');
  });

  it('writes an audit row for every RPC that changes state', async () => {
    const c: Record<string, string> = {};
    const steps: [string, string, () => Record<string, unknown>, ((r: unknown) => void)?][] = [
      ['set_display_name', player, () => ({ p_name: 'Pat' })],
      ['create_season', admin, () => ({ p_name: 'Gate', p_settings: {} }), (r) => (c.season = r as string)],
      ['update_season_settings', admin, () => ({ p_season: c.season, p_settings: { donations_enabled: true } })],
      ['create_league', admin, () => ({ p_season: c.season, p_name: 'L' }), (r) => (c.league = r as string)],
      ['create_invite', admin, () => ({ p_league: c.league, p_code: 'GATE01', p_max_uses: 5, p_expires_at: null })],
      ['join_league', player, () => ({ p_code: 'GATE01', p_team_name: 'Pats' }), (r) => (c.membership = r as string)],
      ['create_stage', admin, () => ({ p_season: c.season, p_name: 'Fall', p_starts_on: '2026-10-18', p_ends_on: '2026-11-08',
        p_tournament: null }), (r) => (c.stage = r as string)],
      ['update_stage', admin, () => ({ p_stage: c.stage, p_name: 'Fall beta', p_starts_on: '2026-10-18',
        p_ends_on: '2026-11-08', p_tournament: 'Nov' })],
      ['grant_stage_allowance', admin, () => ({ p_stage: c.stage })],
      ['record_donation', admin, () => ({ p_membership: c.membership, p_dollars: 5, p_note: null })],
      ['adjust_credits', admin, () => ({ p_membership: c.membership, p_amount: -1, p_note: 'gate' })],
      ['add_athlete', admin, () => ({ p_season: c.season, p_name: 'Pat', p_user: null }), (r) => (c.athlete = r as string)],
      ['set_athlete_opt_in', admin, () => ({ p_athlete: c.athlete, p_opted_in: true })],
      ['link_athlete_user', admin, () => ({ p_athlete: c.athlete, p_user: player })],
      ['grant_role', admin, () => ({ p_user: keeper, p_role: 'stat_keeper' })],
      ['revoke_role', admin, () => ({ p_user: player, p_role: 'treasurer' })],
      ['create_session', keeper, () => ({ p_season: c.season, p_kind: 'practice', p_held_on: '2026-11-16', p_counts: true }),
        (r) => (c.session = r as string)],
      ['save_taps', keeper, () => {
        const now = new Date().toISOString();
        return { p_session: c.session, p_client_now: now, p_taps: [tap(c.athlete, 'goal', now)] };
      }],
      ['set_attendance', player, () => ({ p_session: c.session, p_athlete: c.athlete, p_status: 'present' })],
      ['report_injury', player, () => ({ p_athlete: c.athlete }), (r) => (c.injury = r as string)],
      ['confirm_injury', keeper, () => ({ p_injury: c.injury })],
      ['clear_injury', player, () => ({ p_athlete: c.athlete })],
      ['verify_session', verifier, () => ({ p_session: c.session, p_lines: [{ athlete_id: c.athlete, stats: { goal: 1 } }] })],
      ['reopen_session', verifier, () => ({ p_session: c.session })],
      ['correct_stat_line', admin, () => ({ p_session: c.session, p_athlete: c.athlete, p_stats: { goal: 2 } })],
    ];

    const covered = new Set(steps.map(([name]) => name));
    const missing = fns.map((f) => f.name).filter((n) => !READ_HELPERS.includes(n) && !covered.has(n));
    expect(missing, 'add an audit step for each new RPC').toEqual([]);

    for (const [name, who, args, keep] of steps) {
      if (name === 'correct_stat_line') {
        // Needs a verified, locked session: re-verify, then push verified_at past the lock.
        await as(db, verifier, (tx) =>
          rpc(tx, 'verify_session', { p_session: c.session, p_lines: [{ athlete_id: c.athlete, stats: { goal: 1 } }] }),
        );
        await db.query(`update public.sessions set verified_at = now() - interval '49 hours' where id = $1`, [c.session]);
      }
      const result = await as(db, who, (tx) => rpc(tx, name, args()));
      keep?.(result);
      const n = await db.query<{ n: number }>(
        `select count(*)::int as n from public.audit_log where action = $1 and actor = $2`, [name, who]);
      expect(n.rows[0].n, name).toBeGreaterThan(0);
    }
  });
});
