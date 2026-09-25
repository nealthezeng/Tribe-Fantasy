import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { as, createUser, freshDb, makeAdmin, migrationSql, rpc } from './helpers';

let db: PGlite;
let admin: string;
let season: string;
let league: string;

const settings = (s: object) => as(db, admin, (tx) => rpc(tx, 'update_season_settings', { p_season: season, p_settings: s }));
const stage = (name: string, starts: string, ends: string, tournament: string | null = null) =>
  as(db, admin, (tx) => rpc(tx, 'create_stage', {
    p_season: season, p_name: name, p_starts_on: starts, p_ends_on: ends, p_tournament: tournament,
  })) as Promise<string>;
const grant = (stageId: string) => as(db, admin, (tx) => rpc(tx, 'grant_stage_allowance', { p_stage: stageId }));

/** A signed-up user with a profile who joined `league`; returns [userId, membershipId]. */
async function member(name: string, code = 'LEAGUE1'): Promise<[string, string]> {
  const uid = await createUser(db, `${name}@x.test`);
  await as(db, uid, (tx) => rpc(tx, 'set_display_name', { p_name: name }));
  const mid = (await as(db, uid, (tx) => rpc(tx, 'join_league', { p_code: code, p_team_name: name }))) as string;
  return [uid, mid];
}
const amounts = async (mid: string) =>
  (await db.query<{ kind: string; amount: number }>(
    `select kind, amount from public.credit_ledger where membership_id = $1 order by id`, [mid])).rows;
const pointsAre = (byMembership: Record<string, number>) =>
  db.exec(`create or replace function private.standings_points(p_membership uuid) returns numeric
    language sql stable security definer set search_path = '' as $$
      select coalesce((('${JSON.stringify(byMembership)}'::jsonb) ->> p_membership::text)::numeric, 0)
    $$;`);

beforeEach(async () => {
  db = await freshDb();
  admin = await createUser(db, 'admin@x.test');
  await makeAdmin(db, admin);
  await as(db, admin, async (tx) => {
    season = (await rpc(tx, 'create_season', { p_name: '2026-27', p_settings: {} })) as string;
    league = (await rpc(tx, 'create_league', { p_season: season, p_name: 'League A' })) as string;
    await rpc(tx, 'create_invite', { p_league: league, p_code: 'LEAGUE1', p_max_uses: 50, p_expires_at: null });
  });
});

describe('stages', () => {
  it('creates stages, refuses overlaps, bad dates and duplicate names, and audits', async () => {
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08', 'Nov tourney');
    await expect(stage('Clash', '2026-11-08', '2026-11-20')).rejects.toThrow('STAGE_OVERLAP');
    await expect(stage('Backwards', '2027-02-10', '2027-02-01')).rejects.toThrow('INVALID_DATES');
    await expect(stage('Fall beta', '2027-01-01', '2027-01-20')).rejects.toThrow('STAGE_EXISTS');
    await expect(stage('Blank tournament ok', '2027-01-01', '2027-01-20', '  ')).resolves.toBeTruthy();
    const row = await db.query<{ tournament: string }>(`select tournament from public.stages where id = $1`, [fall]);
    expect(row.rows[0].tournament).toBe('Nov tourney');
    const log = await db.query(`select 1 from public.audit_log where action = 'create_stage'`);
    expect(log.rows).toHaveLength(2);
  });

  it('updates a stage without tripping over its own dates', async () => {
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    await stage('Spring 1', '2027-02-01', '2027-02-21');
    const update = (starts: string, ends: string) => as(db, admin, (tx) => rpc(tx, 'update_stage', {
      p_stage: fall, p_name: 'Fall', p_starts_on: starts, p_ends_on: ends, p_tournament: null }));
    await update('2026-10-19', '2026-11-09');
    await expect(update('2026-10-19', '2027-02-01')).rejects.toThrow('STAGE_OVERLAP');
    const row = await db.query<{ name: string; ends_on: string }>(`select name, ends_on::text from public.stages where id = $1`, [fall]);
    expect(row.rows[0]).toEqual({ name: 'Fall', ends_on: '2026-11-09' });
  });

  it('is admin-only to write and readable by any signed-in user', async () => {
    const [alice] = await member('alice');
    await expect(as(db, alice, (tx) => rpc(tx, 'create_stage', {
      p_season: season, p_name: 'X', p_starts_on: '2026-10-01', p_ends_on: '2026-10-02', p_tournament: null,
    }))).rejects.toThrow('FORBIDDEN');
    await stage('Fall beta', '2026-10-18', '2026-11-08');
    const outsider = await createUser(db, 'out@x.test');
    const rows = await as(db, outsider, (tx) => tx.query(`select name from public.stages`));
    expect(rows.rows).toHaveLength(1);
  });
});

describe('grant_stage_allowance', () => {
  it('gives everyone base + gap/2 while all are tied, and only late joiners on a re-run', async () => {
    // Season saved with {}: the SQL fallbacks must match DEFAULT_SETTINGS (100 + 30 / 2 = 115).
    const tied = DEFAULT_SETTINGS.allowance_base + DEFAULT_SETTINGS.allowance_gap / 2;
    expect(tied).toBe(115);
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    const [, a] = await member('alice');
    const [, b] = await member('bob');
    expect(await grant(fall)).toBe(2);
    expect(await amounts(a)).toEqual([{ kind: 'allowance', amount: tied }]);
    const [, c] = await member('carol');
    expect(await grant(fall)).toBe(1);
    expect(await amounts(c)).toEqual([{ kind: 'allowance', amount: tied }]);
    expect(await amounts(b)).toHaveLength(1);
  });

  it('pays the worst rank the most and shares tied ranks', async () => {
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    const [, a] = await member('alice');
    const [, b] = await member('bob');
    const [, c] = await member('carol');
    const [, d] = await member('dave');
    // ranks: a 1, b and c tied for 2-3 (2.5), d 4. n = 4 → 100 + 30 × (r − 1) / 3
    await pointsAre({ [a]: 9, [b]: 5, [c]: 5, [d]: 1 });
    await grant(fall);
    expect((await amounts(a))[0].amount).toBe(100);
    expect((await amounts(b))[0].amount).toBe(115);
    expect((await amounts(c))[0].amount).toBe(115);
    expect((await amounts(d))[0].amount).toBe(130);
  });

  it('uses the season settings, ranks per league, rounds, and gives base alone to a lone member', async () => {
    await settings({ allowance_base: 50, allowance_gap: 10 });
    await as(db, admin, async (tx) => {
      const id = (await rpc(tx, 'create_league', { p_season: season, p_name: 'League B' })) as string;
      await rpc(tx, 'create_invite', { p_league: id, p_code: 'LEAGUE2', p_max_uses: 50, p_expires_at: null });
    });
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    const [, a] = await member('alice');
    const [, b] = await member('bob');
    const [, c] = await member('carol');
    const [, solo] = await member('solo', 'LEAGUE2');
    await pointsAre({ [a]: 3, [b]: 2, [c]: 1 });
    await grant(fall);
    expect((await amounts(b))[0].amount).toBe(55);
    expect((await amounts(c))[0].amount).toBe(60);
    expect((await amounts(solo))[0].amount).toBe(50);
    await pointsAre({});
    await settings({ allowance_base: 100, allowance_gap: 25 });
    const spring = await stage('Spring 1', '2027-02-01', '2027-02-21');
    await grant(spring);
    expect((await amounts(a))[1].amount).toBe(113); // 112.5 rounds half up
  });

  it('still lets a season with stages and ledger entries be deleted', async () => {
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    await member('alice');
    await grant(fall);
    await db.query(`delete from public.seasons where id = $1`, [season]);
    const left = await db.query(`select 1 from public.credit_ledger union all select 1 from public.stages`);
    expect(left.rows).toEqual([]);
  });

  it('skips zero allowances and is admin-only', async () => {
    await settings({ allowance_base: 0, allowance_gap: 0 });
    const fall = await stage('Fall beta', '2026-10-18', '2026-11-08');
    const [alice, a] = await member('alice');
    expect(await grant(fall)).toBe(0);
    expect(await amounts(a)).toEqual([]);
    await expect(as(db, alice, (tx) => rpc(tx, 'grant_stage_allowance', { p_stage: fall }))).rejects.toThrow('FORBIDDEN');
  });
});

describe('donations and adjustments', () => {
  it('refuses donations while donations_enabled is off', async () => {
    const [, a] = await member('alice');
    await expect(as(db, admin, (tx) => rpc(tx, 'record_donation', { p_membership: a, p_dollars: 5, p_note: null })))
      .rejects.toThrow('DONATIONS_DISABLED');
  });

  it('lets a treasurer record a donation to the team at credits_per_dollar', async () => {
    await settings({ donations_enabled: true });
    const [alice, a] = await member('alice');
    const treasurer = await createUser(db, 't@x.test');
    await db.query(`insert into public.user_roles (user_id, role) values ($1, 'treasurer')`, [treasurer]);
    await as(db, treasurer, (tx) => rpc(tx, 'record_donation', { p_membership: a, p_dollars: 12.5, p_note: ' Venmo to club ' }));
    const row = await db.query<{ kind: string; amount: number; dollars: string; note: string; created_by: string }>(
      `select kind, amount, dollars::text, note, created_by from public.credit_ledger where membership_id = $1`, [a]);
    expect(row.rows).toEqual([{
      kind: 'donation', amount: 12.5 * DEFAULT_SETTINGS.credits_per_dollar, dollars: '12.50', note: 'Venmo to club',
      created_by: treasurer,
    }]);
    await expect(as(db, alice, (tx) => rpc(tx, 'record_donation', { p_membership: a, p_dollars: 5, p_note: null })))
      .rejects.toThrow('FORBIDDEN');
    for (const bad of [0, -5, 10000.01, 1.234, 0.01]) {
      await expect(as(db, admin, (tx) => rpc(tx, 'record_donation', { p_membership: a, p_dollars: bad, p_note: null })))
        .rejects.toThrow('INVALID_AMOUNT');
    }
  });

  it('adjusts credits with a required note, admin only', async () => {
    const [alice, a] = await member('alice');
    const adjust = (who: string, amount: number, note: string | null) =>
      as(db, who, (tx) => rpc(tx, 'adjust_credits', { p_membership: a, p_amount: amount, p_note: note }));
    await expect(adjust(admin, -10, '  ')).rejects.toThrow('NOTE_REQUIRED');
    await expect(adjust(admin, 0, 'x')).rejects.toThrow('INVALID_AMOUNT');
    await expect(adjust(alice, 10, 'x')).rejects.toThrow('FORBIDDEN');
    await expect(adjust(admin, 10, 'x'.repeat(201))).rejects.toThrow('INVALID_NOTE');
    await adjust(admin, -10, 'double allowance');
    expect(await amounts(a)).toEqual([{ kind: 'adjustment', amount: -10 }]);
  });
});

describe('credit_ledger reads', () => {
  it('shows members only their own entries; treasurers and admins see all; outsiders none', async () => {
    await settings({ donations_enabled: true });
    const [alice, a] = await member('alice');
    const [, b] = await member('bob');
    await as(db, admin, (tx) => rpc(tx, 'adjust_credits', { p_membership: a, p_amount: 5, p_note: 'a' }));
    await as(db, admin, (tx) => rpc(tx, 'adjust_credits', { p_membership: b, p_amount: 7, p_note: 'b' }));
    const read = (uid: string) => as(db, uid, (tx) => tx.query<{ amount: number }>(`select amount from public.credit_ledger order by id`));
    expect((await read(alice)).rows).toEqual([{ amount: 5 }]);
    expect((await read(admin)).rows).toHaveLength(2);
    const treasurer = await createUser(db, 't@x.test');
    await db.query(`insert into public.user_roles (user_id, role) values ($1, 'treasurer')`, [treasurer]);
    expect((await read(treasurer)).rows).toHaveLength(2);
    expect((await read(await createUser(db, 'out@x.test'))).rows).toEqual([]);
  });
});

describe('join_league cap', () => {
  it('refuses joins past max_members, across invites, but still says ALREADY_MEMBER first', async () => {
    await settings({ max_members: 2 });
    await as(db, admin, (tx) => rpc(tx, 'create_invite', { p_league: league, p_code: 'OTHER1', p_max_uses: 50, p_expires_at: null }));
    const [alice] = await member('alice');
    await member('bob', 'OTHER1');
    await expect(member('carol')).rejects.toThrow('LEAGUE_FULL');
    await expect(as(db, alice, (tx) => rpc(tx, 'join_league', { p_code: 'OTHER1', p_team_name: 'again' })))
      .rejects.toThrow('ALREADY_MEMBER');
  });

  it('defaults to DEFAULT_SETTINGS.max_members (6)', async () => {
    for (let i = 1; i <= DEFAULT_SETTINGS.max_members; i++) await member(`m${i}`);
    await expect(member('one_more')).rejects.toThrow('LEAGUE_FULL');
  });
});

describe('0006 settings cleanup', () => {
  it('strips the retired keys from seasons saved before M4', async () => {
    const old = await freshDb('0006');
    await old.query(`insert into public.seasons (name, settings)
      values ('old', '{"min_credits_to_play":100,"free_entry":false,"extra_credit_cap":null,"roster_size":5}')`);
    await old.exec(migrationSql('0006_stages_wallet.sql'));
    const row = await old.query<{ settings: object }>(`select settings from public.seasons`);
    expect(row.rows[0].settings).toEqual({ roster_size: 5 });
  });
});
