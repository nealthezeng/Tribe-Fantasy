import type { PGlite } from '@electric-sql/pglite';
import type { TournamentRows } from '../../src/app/lib/tournament';
import { as, createUser, freshDb, makeAdmin, rpc, tiedRanks } from './helpers';

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
export async function auctionFixture(athleteCount = 8, settings: object = {}, stopBefore?: string): Promise<AuctionFixture> {
  const db = await freshDb(stopBefore);
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

export const grant = async (f: AuctionFixture) => {
  const ranks = await tiedRanks(f.db);
  return as(f.db, f.admin, (tx) => rpc(tx, 'grant_stage_allowance', { p_stage: f.stage, p_ranks: ranks }));
};
export const openAuction = (f: AuctionFixture, closeAt: string | null = inAnHour()) =>
  as(f.db, f.admin, (tx) => rpc(tx, 'open_auction', { p_stage: f.stage, p_close_at: closeAt }));
/** Superuser write: moves the close time into the past without waiting. */
export const closeBids = (f: AuctionFixture) =>
  f.db.query(`update public.stages set bid_close_at = now() - interval '1 second' where id = $1`, [f.stage]);
export const runAuction = (f: AuctionFixture) =>
  as(f.db, f.admin, (tx) => rpc(tx, 'run_auction', { p_stage: f.stage })) as Promise<{ by_bid: number; empty: number }>;

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

const iso = (col: string) => `to_json(${col}) #>> '{}' as ${col}`;

/** Every row the way loadLeagueRows reads them for staff (with live taps). Mirror loadLeagueRows' column lists. */
export async function readLeagueRows(f: AuctionFixture): Promise<TournamentRows> {
  const q = async <T,>(sql: string, params: unknown[] = []) => (await f.db.query<T>(sql, params)).rows;
  const hasOuts = (await q<{ t: string | null }>(`select to_regclass('public.outs')::text as t`))[0].t !== null;
  return {
    settings: (await q<{ settings: unknown }>('select settings from public.seasons where id = $1', [f.season]))[0].settings,
    stages: await q(`select id, name, starts_on::text, ends_on::text, ${iso('bid_close_at')}, auction_seed, ${iso('auction_run_at')}
      from public.stages where season_id = $1`, [f.season]),
    games: await q(`select id, stage_id, number, session_id, ${iso('started_at')}, ${iso('finished_at')} from public.games`),
    pairings: await q('select game_id, home, away from public.game_pairings where league_id = $1', [f.league]),
    members: await q(`select id, team_name, ${iso('created_at')}, ${iso('removed_at')}, user_id from public.memberships where league_id = $1`, [f.league]),
    slots: await q('select stage_id, membership_id, athlete_id, price, share::float8 as share, from_game, until_game from public.roster_slots'),
    picks: await q('select stage_id, game_number, membership_id, athlete_id from public.game_picks'),
    sessions: await q(`select id, ${iso('verified_at')} from public.sessions where id in (select session_id from public.games)`),
    lines: await q('select session_id, athlete_id, stats, points_played from public.stat_lines'),
    taps: await q(`select id, session_id, athlete_id, stat, keeper_id, ${iso('tapped_at')}, undoes from public.stat_taps`),
    injuries: await q(`select athlete_id, ${iso('confirmed_at')}, ${iso('cleared_at')} from public.injuries`),
    outs: hasOuts ? await q('select stage_id, athlete_id, from_game, until_game from public.outs') : [],
    athletes: await q('select id, name from public.athletes where season_id = $1', [f.season]),
  };
}
