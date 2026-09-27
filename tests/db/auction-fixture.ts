import type { PGlite } from '@electric-sql/pglite';
import { as, createUser, freshDb, makeAdmin, rpc } from './helpers';

export interface AuctionFixture {
  db: PGlite;
  admin: string;
  season: string;
  league: string;
  stage: string;
  /** Opted-in athletes named A0, A1, … */
  athletes: string[];
}

export const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

/** One season (with `settings`), league A (invite LEAGUE1), stage "Fall beta", `athleteCount` athletes. */
export async function auctionFixture(athleteCount = 8, settings: object = {}): Promise<AuctionFixture> {
  const db = await freshDb();
  const admin = await createUser(db, 'admin@x.test');
  await makeAdmin(db, admin);
  const ids = await as(db, admin, async (tx) => {
    const season = (await rpc(tx, 'create_season', { p_name: '2026-27', p_settings: settings })) as string;
    const league = (await rpc(tx, 'create_league', { p_season: season, p_name: 'League A' })) as string;
    await rpc(tx, 'create_invite', { p_league: league, p_code: 'LEAGUE1', p_max_uses: 50, p_expires_at: null });
    const stage = (await rpc(tx, 'create_stage', {
      p_season: season, p_name: 'Fall beta', p_starts_on: '2026-10-18', p_ends_on: '2026-11-08', p_tournament: null,
    })) as string;
    const athletes: string[] = [];
    for (let i = 0; i < athleteCount; i++) {
      athletes.push((await rpc(tx, 'add_athlete', { p_season: season, p_name: `A${i}`, p_user: null })) as string);
    }
    return { season, league, stage, athletes };
  });
  return { db, admin, ...ids };
}

/** A signed-up user with a profile who joined via `code`; returns [userId, membershipId]. */
export async function member(db: PGlite, name: string, code = 'LEAGUE1'): Promise<[string, string]> {
  const uid = await createUser(db, `${name}@x.test`);
  await as(db, uid, (tx) => rpc(tx, 'set_display_name', { p_name: name }));
  const mid = (await as(db, uid, (tx) => rpc(tx, 'join_league', { p_code: code, p_team_name: name }))) as string;
  return [uid, mid];
}

export const grant = (f: AuctionFixture) => as(f.db, f.admin, (tx) => rpc(tx, 'grant_stage_allowance', { p_stage: f.stage }));
export const openAuction = (f: AuctionFixture, closeAt: string | null = inAnHour()) =>
  as(f.db, f.admin, (tx) => rpc(tx, 'open_auction', { p_stage: f.stage, p_close_at: closeAt }));
/** Superuser write: moves the close time into the past without waiting. */
export const closeBids = (f: AuctionFixture) =>
  f.db.query(`update public.stages set bid_close_at = now() - interval '1 second' where id = $1`, [f.stage]);
export const runAuction = (f: AuctionFixture) =>
  as(f.db, f.admin, (tx) => rpc(tx, 'run_auction', { p_stage: f.stage })) as Promise<{ by_bid: number; by_fill: number; empty: number }>;

export const bid = (f: AuctionFixture, uid: string, mid: string, athlete: string, amount: number | null) =>
  as(f.db, uid, (tx) => rpc(tx, 'place_bid', { p_stage: f.stage, p_membership: mid, p_athlete: athlete, p_amount: amount }));
export const unbid = (f: AuctionFixture, uid: string, mid: string, athlete: string) =>
  as(f.db, uid, (tx) => rpc(tx, 'delete_bid', { p_stage: f.stage, p_membership: mid, p_athlete: athlete }));

export interface SlotRow { membership_id: string; athlete_id: string; price: number; via: 'bid' | 'fill' }
export const slots = async (f: AuctionFixture) =>
  (await f.db.query<SlotRow>(
    `select membership_id, athlete_id, price, via from public.roster_slots where stage_id = $1 order by via, athlete_id`,
    [f.stage])).rows;

/** Superuser write: a keeper-confirmed injury. */
export const injure = (f: AuctionFixture, athlete: string) =>
  f.db.query(`insert into public.injuries (athlete_id, confirmed_at) values ($1, now())`, [athlete]);
