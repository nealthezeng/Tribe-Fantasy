import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string) => readFileSync(root + rel, 'utf8');

/** A database with every migration applied, or only those sorting before `stopBefore` (e.g. '0006'). */
export async function freshDb(stopBefore?: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(read('tests/db/shim.sql'));
  const files = readdirSync(root + 'supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (stopBefore && f >= stopBefore) break;
    await db.exec(migrationSql(f));
  }
  return db;
}

export const migrationSql = (file: string) => read(`supabase/migrations/${file}`);

export async function createUser(db: PGlite, email: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  return id;
}

export async function makeAdmin(db: PGlite, userId: string): Promise<void> {
  await db.query(`insert into public.user_roles (user_id, role) values ($1, 'admin')`, [userId]);
}

/** Run `fn` as a signed-in user (or as anon when userId is null), like a PostgREST request. */
export function as<T>(db: PGlite, userId: string | null, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    await tx.exec(userId ? 'set local role authenticated' : 'set local role anon');
    return fn(tx);
  });
}

/** Call public.<fn>(p_x => $1, ...). Objects are sent as JSON text. */
export async function rpc(tx: Transaction, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const keys = Object.keys(args);
  const params = keys.map((k) => {
    const v = args[k];
    return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as result`;
  const res = await tx.query<{ result: unknown }>(sql, params);
  return res.rows[0]?.result;
}
