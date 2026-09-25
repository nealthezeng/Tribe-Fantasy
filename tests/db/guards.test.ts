import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { freshDb } from './helpers';

let db: PGlite;
beforeAll(async () => { db = await freshDb(); });

describe('database guards', () => {
  it('enables RLS on every public table', async () => {
    const { rows } = await db.query<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`);
    expect(rows).toEqual([]);
  });

  it('never lets anon/authenticated write public relations directly', async () => {
    const { rows } = await db.query(`
      select c.relname, g.grantee
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) as g(grantee)
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (
          has_table_privilege(g.grantee, c.oid, 'INSERT')
          or has_table_privilege(g.grantee, c.oid, 'UPDATE')
          or has_table_privilege(g.grantee, c.oid, 'DELETE')
          or has_table_privilege(g.grantee, c.oid, 'TRUNCATE')
          or has_any_column_privilege(g.grantee, c.oid, 'INSERT')
          or has_any_column_privilege(g.grantee, c.oid, 'UPDATE')
        )`);
    expect(rows).toEqual([]);
  });

  it('never lets anon read public relations at all', async () => {
    const { rows } = await db.query(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (
          has_table_privilege('anon', c.oid, 'SELECT')
          or has_any_column_privilege('anon', c.oid, 'SELECT')
        )`);
    expect(rows).toEqual([]);
  });

  it('never lets anon/authenticated use or update public sequences', async () => {
    const { rows } = await db.query(`
      select c.relname, g.grantee
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated')) as g(grantee)
      where n.nspname = 'public' and c.relkind = 'S'
        and (
          has_sequence_privilege(g.grantee, c.oid, 'UPDATE')
          or has_sequence_privilege(g.grantee, c.oid, 'USAGE')
        )`);
    expect(rows).toEqual([]);
  });

  it('never allows a public view/matview that is not security_invoker', async () => {
    const { rows } = await db.query(`
      select c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm')
        and not (
          c.reloptions is not null
          and array_to_string(c.reloptions, ',') like '%security_invoker=true%'
        )`);
    expect(rows).toEqual([]);
  });

  it('never lets anon execute public functions', async () => {
    const { rows } = await db.query(`
      select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`);
    expect(rows).toEqual([]);
  });

  it('keeps default privileges tight for objects created after the migrations run', async () => {
    // Regression test for the default-privilege gap: Supabase (and the shim mirroring
    // it) grants anon/authenticated ALL on new tables and EXECUTE on new functions by
    // default. 0002_rls.sql overrides those defaults; this proves it sticks for objects
    // created after the migrations, not just the ones the migrations themselves created.
    // Uses its own db so the probe objects don't leak into the other guard assertions.
    const probeDb = await freshDb();
    await probeDb.exec(`
      create table public.probe_t (id int);
      create function public.probe_f() returns int language sql as 'select 1';`);

    const canInsert = await probeDb.query<{ ok: boolean }>(
      `select has_table_privilege('authenticated', 'public.probe_t', 'INSERT') as ok`
    );
    const canSelectAnon = await probeDb.query<{ ok: boolean }>(
      `select has_table_privilege('anon', 'public.probe_t', 'SELECT') as ok`
    );
    const canExecAnon = await probeDb.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'public.probe_f()', 'execute') as ok`
    );

    expect(canInsert.rows[0]?.ok).toBe(false);
    expect(canSelectAnon.rows[0]?.ok).toBe(false);
    expect(canExecAnon.rows[0]?.ok).toBe(false);
  });
});
