// t217: a manager leaves a league, unless their team has donated, bid, or played a game.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, rpc } from './helpers';
import { auctionFixture, bid, closeBids, grant, member, openAuction, runAuction, type AuctionFixture } from './auction-fixture';

let f: AuctionFixture;
let alice: string, aliceM: string, bob: string, bobM: string;

const leave = (who: string, membership: string) => as(f.db, who, (tx) => rpc(tx, 'leave_league', { p_membership: membership }));
const count = async (sql: string, args: unknown[] = []) =>
  (await f.db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, args)).rows[0].n;

beforeEach(async () => {
  f = await auctionFixture(8, { donations_enabled: true });
  [alice, aliceM] = await member(f.db, 'alice');
  [bob, bobM] = await member(f.db, 'bob');
});

describe('leave_league', () => {
  it('removes the team with its allowance and random-fill players, and audits', async () => {
    await grant(f);
    await openAuction(f);
    await closeBids(f);
    await runAuction(f);
    expect(await count('public.roster_slots where membership_id = $1', [aliceM])).toBeGreaterThan(0);
    await leave(alice, aliceM);
    expect(await count('public.memberships where id = $1', [aliceM])).toBe(0);
    expect(await count('public.credit_ledger where membership_id = $1', [aliceM])).toBe(0);
    expect(await count('public.roster_slots where membership_id = $1', [aliceM])).toBe(0);
    expect(await count('public.memberships where id = $1', [bobM])).toBe(1);
    const a = await f.db.query<{ details: Record<string, unknown> }>(`select details from public.audit_log where action = 'leave_league'`);
    expect(a.rows[0].details).toEqual({ league_id: f.league, team_name: 'alice', league_deleted: false });
  });

  it('refuses a team with a donation', async () => {
    await as(f.db, f.admin, (tx) => rpc(tx, 'record_donation', { p_membership: aliceM, p_dollars: 5, p_note: null }));
    await expect(leave(alice, aliceM)).rejects.toThrow('TEAM_HAS_DONATIONS');
  });

  it('refuses a team with a bid, open or won, but not one whose bid was taken back', async () => {
    await grant(f);
    await openAuction(f);
    await bid(f, alice, aliceM, f.athletes[0], 5);
    await expect(leave(alice, aliceM)).rejects.toThrow('TEAM_HAS_BIDS');
    await as(f.db, alice, (tx) => rpc(tx, 'delete_bid', { p_stage: f.stage, p_membership: aliceM, p_athlete: f.athletes[0] }));
    // A player won by bidding (superuser write, so no bid row is left behind) still counts.
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 5, 'bid')`, [f.stage, aliceM, f.league, f.athletes[1]]);
    await expect(leave(alice, aliceM)).rejects.toThrow('TEAM_HAS_BIDS');
    await f.db.query(`delete from public.roster_slots where membership_id = $1`, [aliceM]);
    await leave(alice, aliceM);
  });

  it("refuses a team paired in a game, home or away, so the opponent's result stays", async () => {
    const game = (await f.db.query<{ id: string }>(
      `insert into public.games (stage_id, number) values ($1, 1) returning id`, [f.stage])).rows[0].id;
    await f.db.query(`insert into public.game_pairings (game_id, league_id, home, away) values ($1, $2, $3, $4)`,
      [game, f.league, bobM, aliceM]);
    await expect(leave(alice, aliceM)).rejects.toThrow('TEAM_HAS_GAMES');
    await expect(leave(bob, bobM)).rejects.toThrow('TEAM_HAS_GAMES');
  });

  it('leaves with a game-1 pick and a bench set before the tournament opens (own data only)', async () => {
    await grant(f);
    await openAuction(f);
    await closeBids(f);
    await runAuction(f);
    const [slot] = (await f.db.query<{ athlete_id: string }>(
      'select athlete_id from public.roster_slots where membership_id = $1 limit 1', [aliceM])).rows;
    await f.db.query('update public.roster_slots set bench = true where membership_id = $1 and athlete_id = $2', [aliceM, slot.athlete_id]);
    await f.db.query(`insert into public.game_picks (stage_id, game_number, membership_id, league_id, athlete_id)
      values ($1, 1, $2, $3, $4)`, [f.stage, aliceM, f.league, slot.athlete_id]);
    await leave(alice, aliceM);
    expect(await count('public.game_picks where membership_id = $1', [aliceM])).toBe(0);
  });

  it('deletes a league once its last team leaves, even one its creator did not make (documented behaviour)', async () => {
    // League A is an older, admin-made league: created_by is null.
    await leave(alice, aliceM);
    expect(await count('public.leagues where id = $1', [f.league])).toBe(1);
    await leave(bob, bobM);
    expect(await count('public.leagues where id = $1', [f.league])).toBe(0);
  });

  it("refuses someone else's team and unknown ids alike", async () => {
    await expect(leave(bob, aliceM)).rejects.toThrow('NOT_MEMBER');
    await expect(leave(alice, '00000000-0000-0000-0000-000000000000')).rejects.toThrow('NOT_MEMBER');
    await expect(leave(f.admin, aliceM)).rejects.toThrow('NOT_MEMBER');
  });
});

describe('leave_league by the creator', () => {
  const create = (who: string, name: string) =>
    as(f.db, who, (tx) => rpc(tx, 'create_my_league', { p_name: name, p_password: null, p_team_name: 'Mine' })) as Promise<string>;
  const myMembership = async (who: string, league: string) =>
    (await f.db.query<{ id: string }>('select id from public.memberships where league_id = $1 and user_id = $2', [league, who])).rows[0].id;

  it('deletes the league when the creator was its only team', async () => {
    const league = await create(alice, 'Solo');
    await leave(alice, await myMembership(alice, league));
    expect(await count('public.leagues where id = $1', [league])).toBe(0);
    const a = await f.db.query<{ details: Record<string, unknown> }>(`select details from public.audit_log where action = 'leave_league'`);
    expect(a.rows[0].details).toMatchObject({ league_id: league, league_deleted: true });
  });

  it('keeps the creator when someone else leaves', async () => {
    const league = await create(alice, 'Kept');
    await as(f.db, bob, (tx) => rpc(tx, 'join_open_league', { p_league: league, p_password: null, p_team_name: 'Bobs' }));
    await leave(bob, await myMembership(bob, league));
    const l = await f.db.query<{ created_by: string | null }>('select created_by from public.leagues where id = $1', [league]);
    expect(l.rows[0].created_by).toBe(alice);
  });

  it('keeps the league for the other teams, hands it to admins, and frees the create slot', async () => {
    const league = await create(alice, 'Shared');
    await as(f.db, bob, (tx) => rpc(tx, 'join_open_league', { p_league: league, p_password: null, p_team_name: 'Bobs' }));
    await leave(alice, await myMembership(alice, league));
    const l = await f.db.query<{ created_by: string | null }>('select created_by from public.leagues where id = $1', [league]);
    expect(l.rows[0].created_by).toBeNull();
    await create(alice, 'Another');
  });
});
