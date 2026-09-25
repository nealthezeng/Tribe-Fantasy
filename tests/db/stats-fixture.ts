import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin, rpc } from './helpers';

export interface StatsFixture {
  db: PGlite;
  admin: string;
  k1: string;
  k2: string;
  k3: string;
  member: string;
  stranger: string;
  season: string;
  league: string;
  sam: string;
  ali: string;
  session: string;
}

export const makeKeeper = (db: PGlite, id: string) =>
  db.query(`insert into public.user_roles (user_id, role) values ($1, 'stat_keeper')`, [id]);

/** Superuser write that skips RPCs, e.g. to push a session past its lock. */
export const backdateVerify = (db: PGlite, session: string, hoursAgo: number) =>
  db.query(`update public.sessions set verified_at = now() - $2 * interval '1 hour' where id = $1`, [session, hoursAgo]);

export const tap = (athlete: string, stat: string, at: string, undoes: string | null = null) => ({
  id: crypto.randomUUID(),
  athlete_id: athlete,
  stat,
  tapped_at: at,
  undoes,
});

/** Season with {} settings (so the SQL stat_weights fallback applies), one league, two athletes, one session. */
export async function statsFixture(): Promise<StatsFixture> {
  const db = await freshDb();
  const admin = await createUser(db, 'admin@x.test');
  const k1 = await createUser(db, 'k1@x.test');
  const k2 = await createUser(db, 'k2@x.test');
  const k3 = await createUser(db, 'k3@x.test');
  const member = await createUser(db, 'member@x.test');
  const stranger = await createUser(db, 'stranger@x.test');
  await makeAdmin(db, admin);
  for (const k of [k1, k2, k3]) await makeKeeper(db, k);
  const { season, league, sam, ali } = await as(db, admin, async (tx) => {
    const season = (await rpc(tx, 'create_season', { p_name: 'Spring', p_settings: {} })) as string;
    const league = (await rpc(tx, 'create_league', { p_season: season, p_name: 'A' })) as string;
    const sam = (await rpc(tx, 'add_athlete', { p_season: season, p_name: 'Sam', p_user: null })) as string;
    const ali = (await rpc(tx, 'add_athlete', { p_season: season, p_name: 'Ali', p_user: null })) as string;
    return { season, league, sam, ali };
  });
  await db.query(`insert into public.memberships (league_id, user_id, team_name) values ($1, $2, 'Team M')`, [league, member]);
  const session = (await as(db, k1, (tx) =>
    rpc(tx, 'create_session', { p_season: season, p_kind: 'practice', p_held_on: '2026-11-16', p_counts: true }),
  )) as string;
  return { db, admin, k1, k2, k3, member, stranger, season, league, sam, ali, session };
}
