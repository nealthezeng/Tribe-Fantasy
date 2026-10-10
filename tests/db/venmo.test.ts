// Venmo donations (spec 2026-10-10-venmo-donations-design.md): team codes, idempotent donation insert, and (Task 2)
// receipt ingest. The Edge Function itself is checked by hand at go-live (no Deno in CI).
import { beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin, migrationSql, rpc } from './helpers';
import { member } from './auction-fixture';

let db: PGlite;
let admin: string, season: string, aliceM: string, bobM: string;

const CODE = /^[BCDFGHJKMNPQRSTVWXZ]{4}$/;
const settings = (s: object) => as(db, admin, (tx) => rpc(tx, 'update_season_settings', { p_season: season, p_settings: s }));
const code = async (mid: string) =>
  (await db.query<{ c: string }>('select donation_code as c from public.memberships where id = $1', [mid])).rows[0].c;
/** Superuser write: fixed codes, so tests never depend on the random ones. */
const setCode = (mid: string, c: string) => db.query('update public.memberships set donation_code = $2 where id = $1', [mid, c]);
const ledger = async (mid: string) => (await db.query<{ amount: number; dollars: string; note: string; source_ref: string | null;
  created_by: string | null }>(
  'select amount, dollars::text as dollars, note, source_ref, created_by from public.credit_ledger where membership_id = $1 order by id',
  [mid])).rows;

async function setup(database: PGlite) {
  db = database;
  admin = await createUser(db, 'admin@x.test');
  await makeAdmin(db, admin);
  await as(db, admin, async (tx) => {
    season = (await rpc(tx, 'create_season', { p_name: '2026-27', p_settings: {} })) as string;
    const league = (await rpc(tx, 'create_league', { p_season: season, p_name: 'League A' })) as string;
    await rpc(tx, 'create_invite', { p_league: league, p_code: 'LEAGUE1', p_max_uses: 50, p_expires_at: null });
  });
  [, aliceM] = await member(db, 'alice');
  [, bobM] = await member(db, 'bob');
}

describe('donation codes', () => {
  beforeEach(async () => setup(await freshDb()));

  it('gives every new team its own 4-consonant code', async () => {
    await settings({ max_members: 50 }); // 22 teams in one league
    const codes = [await code(aliceM), await code(bobM)];
    for (let i = 0; i < 20; i++) codes.push(await code((await member(db, `m${i}`))[1]));
    for (const c of codes) expect(c).toMatch(CODE);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('refuses a duplicate or malformed code', async () => {
    await setCode(aliceM, 'BKRT');
    await expect(setCode(bobM, 'BKRT')).rejects.toThrow(/unique/);
    await expect(setCode(bobM, 'BART')).rejects.toThrow(/check/);
    await expect(setCode(bobM, 'bkrt')).rejects.toThrow(/check/);
  });
});

describe('0021 backfill', () => {
  it('gives teams that existed before the migration a code', async () => {
    const old = await freshDb('0021');
    await setup(old);
    await old.exec(migrationSql('0021_venmo.sql'));
    expect(await code(aliceM)).toMatch(CODE);
    expect(await code(bobM)).toMatch(CODE);
    expect(await code(aliceM)).not.toBe(await code(bobM));
  });
});

describe('insert_donation', () => {
  beforeEach(async () => setup(await freshDb()));
  const insert = (ref: string | null, dollars = 10) => db.query<{ id: number }>(
    'select private.insert_donation($1, $2, $3, null, $4) as id', [aliceM, dollars, 'Venmo Jane: hi', ref]);

  it('records a donation with its source ref and no creator', async () => {
    await settings({ donations_enabled: true });
    await insert('venmo:123');
    expect(await ledger(aliceM)).toEqual([
      { amount: 200, dollars: '10.00', note: 'Venmo Jane: hi', source_ref: 'venmo:123', created_by: null }]);
    const audit = await db.query<{ details: { source_ref: string } }>(
      `select details from public.audit_log where action = 'record_donation'`);
    expect(audit.rows[0].details.source_ref).toBe('venmo:123');
  });

  it('refuses the same source ref twice but allows any number of manual (null) refs', async () => {
    await settings({ donations_enabled: true });
    await insert('venmo:123');
    await expect(insert('venmo:123')).rejects.toThrow(/unique|duplicate/);
    await insert(null);
    await insert(null);
    expect(await ledger(aliceM)).toHaveLength(3);
  });

  it('keeps record_donation\'s rules: off → DONATIONS_DISABLED, bad amount → INVALID_AMOUNT', async () => {
    await expect(insert('venmo:1')).rejects.toThrow('DONATIONS_DISABLED');
    await settings({ donations_enabled: true });
    await expect(insert('venmo:2', 20000)).rejects.toThrow('INVALID_AMOUNT');
  });
});
