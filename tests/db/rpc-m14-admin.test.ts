// M14 admin powers (spec 2026-10-19-m14-admin-design.md §5.3, §5.4, §6): free share edits, account removal that keeps
// the team, renames, the user list, and sealed reads for admins.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, bid, closeBids, grant, member, openAuction, runAuction, type AuctionFixture } from './auction-fixture';
import { makeKeeper, tap } from './stats-fixture';

let f: AuctionFixture;
let keeper: string, alice: string, aliceM: string, bob: string, bobM: string;

interface SlotRow { athlete_id: string; share: number; price: number; via: string; from_game: number; until_game: number | null }

const setShare = (athlete: string, percent: number | null, mid = aliceM, who = f.admin, stage = f.stage) =>
  as(f.db, who, (tx) => rpc(tx, 'admin_set_share', { p_stage: stage, p_membership: mid, p_athlete: athlete, p_percent: percent }));
const slotRows = async (mid = aliceM) => (await f.db.query<SlotRow>(
  `select athlete_id, share::float8 as share, price, via, from_game, until_game from public.roster_slots
   where stage_id = $1 and membership_id = $2 order by from_game, athlete_id`, [f.stage, mid])).rows;
const live = async (mid = aliceM, athlete?: string) =>
  (await slotRows(mid)).filter((r) => r.until_game === null && (!athlete || r.athlete_id === athlete));
const count = async (sql: string, args: unknown[] = []) =>
  (await f.db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, args)).rows[0].n;
const audit = async (action: string) => (await f.db.query<{ details: Record<string, unknown> }>(
  'select details from public.audit_log where action = $1 order by id', [action])).rows;
const pairings = () => [{ league_id: f.league, home: aliceM, away: bobM }];
const open = () => as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: pairings() })) as Promise<string>;
const start = (game: string) => as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game })) as Promise<string>;
/** A Postgres array literal: the rpc helper sends arrays as JSON (PostgREST converts them itself). */
const pick = (mid: string, number: number, athletes: string[], who = alice) => as(f.db, who, (tx) =>
  rpc(tx, 'set_game_pick', { p_membership: mid, p_stage: f.stage, p_number: number, p_athletes: `{${athletes.join(',')}}` }));
const removeUser = (user: string, who = f.admin) => as(f.db, who, (tx) => rpc(tx, 'admin_remove_user', { p_user: user }));
const A = (i: number) => f.athletes[i];

/** Share buying settled: alice owns A0 (20 credits) and A1 (10), bob A2 (15). */
async function settle() {
  await grant(f);
  await openAuction(f);
  await bid(f, alice, aliceM, A(0), 20);
  await bid(f, alice, aliceM, A(1), 10);
  await bid(f, bob, bobM, A(2), 15);
  await closeBids(f);
  await runAuction(f);
}

beforeEach(async () => {
  f = await auctionFixture(8, { donations_enabled: true });
  keeper = await createUser(f.db, 'keeper@x.test');
  await makeKeeper(f.db, keeper);
  [alice, aliceM] = await member(f.db, 'alice');
  [bob, bobM] = await member(f.db, 'bob');
});

describe('admin_set_share', () => {
  it('refuses before share buying has settled', async () => {
    await expect(setShare(A(5), 25)).rejects.toThrow('SHARES_NOT_SETTLED');
  });

  it('adds a free admin slot from the next game', async () => {
    await settle();
    const before = await count('public.credit_ledger');
    const bal = await count('public.credit_ledger where membership_id = $1', [aliceM]);
    await setShare(A(5), 25);
    expect((await slotRows()).filter((r) => r.athlete_id === A(5))).toEqual([
      { athlete_id: A(5), share: 0.25, price: 0, via: 'admin', from_game: 1, until_game: null }]);
    expect(await count('public.credit_ledger')).toBe(before);
    expect(await count('public.credit_ledger where membership_id = $1', [aliceM])).toBe(bal);
  });

  it('edits in place before the slot has played', async () => {
    await settle();
    await setShare(A(5), 25);
    await setShare(A(5), 40);
    const rows = (await slotRows()).filter((r) => r.athlete_id === A(5));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ share: 0.4, via: 'admin', from_game: 1, until_game: null });
  });

  it('ends a played slot and starts a new one', async () => {
    await settle();
    await start(await open()); // game 1 started: the next game is 2
    await setShare(A(0), 40);
    const rows = (await slotRows()).filter((r) => r.athlete_id === A(0));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ price: 20, via: 'bid', from_game: 1, until_game: 2 });
    expect(rows[1]).toMatchObject({ share: 0.4, price: 0, via: 'admin', from_game: 2, until_game: null });
  });

  it('removes: deletes an unplayed slot, ends a played one, drops the next-game pick', async () => {
    await settle();
    await setShare(A(5), 25);
    await pick(aliceM, 1, [A(5), A(0)]);
    await setShare(A(5), 0); // unplayed: gone
    expect((await slotRows()).filter((r) => r.athlete_id === A(5))).toEqual([]);
    expect(await count('public.game_picks where membership_id = $1 and athlete_id = $2', [aliceM, A(5)])).toBe(0);
    expect(await count('public.game_picks where membership_id = $1 and athlete_id = $2', [aliceM, A(0)])).toBe(1);

    await start(await open()); // next game is 2
    await pick(aliceM, 2, [A(0), A(1)]);
    await setShare(A(0), null); // null = 0 = remove; played: ended at 2
    expect((await slotRows()).filter((r) => r.athlete_id === A(0))).toEqual([
      expect.objectContaining({ price: 20, from_game: 1, until_game: 2 })]);
    // Only the next game's pick goes; the game 1 pick stays as it was played.
    expect(await count('public.game_picks where membership_id = $1 and athlete_id = $2 and game_number = 2', [aliceM, A(0)])).toBe(0);
    expect(await count('public.game_picks where membership_id = $1 and athlete_id = $2 and game_number = 2', [aliceM, A(1)])).toBe(1);
    expect(await count('public.game_picks where membership_id = $1 and athlete_id = $2 and game_number = 1', [aliceM, A(0)])).toBe(1);
  });

  it('remove then add then remove at the same next game', async () => {
    await settle();
    await start(await open()); // next game is 2; A0 was bought from game 1
    await setShare(A(0), 0);
    await setShare(A(0), 30);
    expect(await live(aliceM, A(0))).toEqual([expect.objectContaining({ share: 0.3, from_game: 2, via: 'admin' })]);
    await setShare(A(0), 0);
    expect(await live(aliceM, A(0))).toEqual([]);
    expect((await slotRows()).filter((r) => r.athlete_id === A(0))).toHaveLength(1); // only the ended bought slot
  });

  it('refuses bad input', async () => {
    await settle();
    await expect(setShare(A(5), 101)).rejects.toThrow('INVALID_PERCENT');
    await expect(setShare(A(5), -1)).rejects.toThrow('INVALID_PERCENT');
    await expect(setShare(A(5), 25, aliceM, keeper)).rejects.toThrow('FORBIDDEN');
    await expect(setShare(A(5), 25, crypto.randomUUID())).rejects.toThrow('NOT_FOUND');
    await expect(setShare(A(5), 25, aliceM, f.admin, crypto.randomUUID())).rejects.toThrow('NOT_FOUND');
    await expect(setShare(crypto.randomUUID(), 25)).rejects.toThrow('NOT_FOUND');
    const other = await as(f.db, f.admin, async (tx) => {
      const s = (await rpc(tx, 'create_season', { p_name: 'Other', p_settings: {} })) as string;
      return (await rpc(tx, 'add_athlete', { p_season: s, p_name: 'Far', p_user: null })) as string;
    });
    // The newest season is now "Other", but the stage still belongs to 2026-27.
    await expect(setShare(other, 25)).rejects.toThrow('NOT_FOUND');
    await as(f.db, f.admin, (tx) => rpc(tx, 'set_athlete_opt_in', { p_athlete: A(6), p_opted_in: false }));
    await expect(setShare(A(6), 25)).rejects.toThrow('NOT_OPTED_IN');
    await expect(setShare(A(7), 0)).rejects.toThrow('NOT_FOUND'); // nothing to remove
    // Removing an opted-out player's existing slot is allowed.
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, share, via)
      values ($1, $2, $3, $4, 0, 0.5, 'admin')`, [f.stage, aliceM, f.league, A(6)]);
    await setShare(A(6), 0);
    expect(await live(aliceM, A(6))).toEqual([]);
    await removeUser(bob);
    await expect(setShare(A(5), 25, bobM)).rejects.toThrow('TEAM_REMOVED');
  });

  it('writes no credit_ledger rows and one audit row with old/new percent', async () => {
    await settle();
    const before = await count('public.credit_ledger');
    await setShare(A(5), 25);
    await setShare(A(5), 40);
    await setShare(A(5), 0);
    expect(await count('public.credit_ledger')).toBe(before);
    const rows = await audit('admin_set_share');
    expect(rows.map((r) => r.details)).toEqual([
      { stage: f.stage, membership: aliceM, athlete: A(5), old_percent: 0, new_percent: 25, from_game: 1 },
      { stage: f.stage, membership: aliceM, athlete: A(5), old_percent: 25, new_percent: 40, from_game: 1 },
      { stage: f.stage, membership: aliceM, athlete: A(5), old_percent: 40, new_percent: 0, from_game: 1 },
    ]);
  });
});

describe('roster readers', () => {
  it('set_game_pick accepts an admin-added player and refuses one whose slot ended', async () => {
    await settle();
    await setShare(A(5), 25);
    await pick(aliceM, 1, [A(5)]);
    expect(await count('public.game_picks where membership_id = $1 and athlete_id = $2', [aliceM, A(5)])).toBe(1);
    await start(await open());
    await setShare(A(0), 0); // ended at game 2
    await expect(pick(aliceM, 2, [A(0)])).rejects.toThrow('NOT_ON_ROSTER');
    await pick(aliceM, 2, [A(1), A(5)]);
  });

  it('picks_wanted counts only live slots', async () => {
    await settle();
    const wanted = async (mid: string) => (await f.db.query<{ n: number }>(
      'select private.picks_wanted($1, $2) as n', [f.stage, mid])).rows[0].n;
    const g1 = await open();
    expect(await wanted(aliceM)).toBe(2);
    await start(g1);
    await setShare(A(0), 0); // alice still has 2 rows, one of them ended
    expect(await wanted(aliceM)).toBe(1);
    expect(await wanted(bobM)).toBe(1);
    // The pick notice for game 2 asks alice for 1 player.
    await as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: g1, p_pairings: pairings(), p_provisional: {} }));
    const body = (await f.db.query<{ body: string }>(
      `select body from private.outbox where membership_id = $1 and kind = 'pick_next' order by id desc limit 1`, [aliceM])).rows[0].body;
    expect(body).toContain('Pick your player on the League page');
  });
});

describe('reset_game after a share edit', () => {
  const reset = (game: string) => as(f.db, f.admin, (tx) => rpc(tx, 'reset_game', { p_game: game }));

  it('the edit applies from the game that is played next, and later edits work', async () => {
    await settle();
    const g1 = await open();
    await start(g1); // next game 2
    await setShare(A(0), 40); // bought row ends at 2, admin row starts at 2
    await reset(g1); // next game is 1 again
    const rows = (await slotRows()).filter((r) => r.athlete_id === A(0));
    expect(rows).toEqual([{ athlete_id: A(0), share: 0.4, price: 0, via: 'admin', from_game: 1, until_game: null }]);
    await pick(aliceM, 1, [A(0), A(1)]); // on the edited roster for game 1
    await setShare(A(0), 0);
    expect((await slotRows()).filter((r) => r.athlete_id === A(0))).toEqual([]);
    await expect(pick(aliceM, 1, [A(0)])).rejects.toThrow('NOT_ON_ROSTER');
    await setShare(A(0), 30); // no unique violation
    expect(await live(aliceM, A(0))).toEqual([expect.objectContaining({ share: 0.3, from_game: 1, via: 'admin' })]);
    await pick(aliceM, 1, [A(0)]);
  });

  it('a slot that started earlier ends at the replayed game instead', async () => {
    await settle();
    const g1 = await open();
    await start(g1);
    const g2 = (await as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: g1, p_pairings: pairings(), p_provisional: {} }))) as string;
    await start(g2); // next game 3
    await setShare(A(0), 40); // bought row (from 1) ends at 3, admin row from 3
    await reset(g2); // next game 2 again
    expect((await slotRows()).filter((r) => r.athlete_id === A(0))).toEqual([
      expect.objectContaining({ price: 20, via: 'bid', from_game: 1, until_game: 2 }),
      expect.objectContaining({ share: 0.4, via: 'admin', from_game: 2, until_game: null })]);
  });
});

describe('admin_rename_team', () => {
  const rename = (mid: string, name: string, who = f.admin) =>
    as(f.db, who, (tx) => rpc(tx, 'admin_rename_team', { p_membership: mid, p_name: name }));

  it('renames and logs old and new', async () => {
    await rename(aliceM, '  Gimp Zeal ');
    expect((await f.db.query<{ team_name: string }>('select team_name from public.memberships where id = $1', [aliceM])).rows[0].team_name)
      .toBe('Gimp Zeal');
    expect((await audit('admin_rename_team'))[0].details).toEqual({ old: 'alice', new: 'Gimp Zeal' });
  });

  it('refuses bad names, a sibling name, non-admins and unknown teams', async () => {
    await expect(rename(aliceM, '')).rejects.toThrow('INVALID_TEAM_NAME');
    await expect(rename(aliceM, 'x'.repeat(41))).rejects.toThrow('INVALID_TEAM_NAME');
    await expect(rename(aliceM, 'bob')).rejects.toThrow('TEAM_NAME_TAKEN');
    await rename(aliceM, 'alice'); // its own name is not "taken"
    await expect(rename(aliceM, 'Zed', keeper)).rejects.toThrow('FORBIDDEN');
    await expect(rename(crypto.randomUUID(), 'Zed')).rejects.toThrow('NOT_FOUND');
  });
});

describe('admin_set_display_name', () => {
  const setName = (user: string, name: string, who = f.admin) =>
    as(f.db, who, (tx) => rpc(tx, 'admin_set_display_name', { p_user: user, p_name: name }));

  it("sets another user's name and logs old and new", async () => {
    await setName(alice, ' Alice Kim ');
    expect((await f.db.query<{ display_name: string }>('select display_name from public.profiles where id = $1', [alice])).rows[0].display_name)
      .toBe('Alice Kim');
    expect((await audit('admin_set_display_name'))[0].details).toEqual({ user: alice, old: 'alice', new: 'Alice Kim' });
  });

  it('refuses empty names, non-admins and users without a profile', async () => {
    await expect(setName(alice, '')).rejects.toThrow('INVALID_NAME');
    await expect(setName(alice, 'Zed', keeper)).rejects.toThrow('FORBIDDEN');
    await expect(setName(crypto.randomUUID(), 'Zed')).rejects.toThrow('NOT_FOUND');
  });
});

describe('list_users', () => {
  const list = (who: string) => as(f.db, who, (tx) => rpc(tx, 'list_users', {})) as Promise<{
    id: string; email: string; display_name: string | null; roles: string[];
    teams: { membership_id: string; league: string; team: string; season: string }[];
    athlete: { id: string; name: string } | null; donations: { count: number; dollars: number } }[]>;

  it('gives an admin every account with roles, teams, linked player and donations', async () => {
    await as(f.db, f.admin, async (tx) => {
      await rpc(tx, 'link_athlete_user', { p_athlete: A(3), p_user: alice });
      await rpc(tx, 'record_donation', { p_membership: aliceM, p_dollars: 5, p_note: null });
      await rpc(tx, 'record_donation', { p_membership: aliceM, p_dollars: 7.5, p_note: null });
    });
    const users = await list(f.admin);
    // display_name nulls last, then email: alice, bob, then the two with no profile (admin, keeper) by email.
    expect(users.map((u) => u.email)).toEqual(['alice@x.test', 'bob@x.test', 'admin@x.test', 'keeper@x.test']);
    const a = users[0];
    expect(a).toMatchObject({ id: alice, display_name: 'alice', roles: [], athlete: { id: A(3), name: 'A3' } });
    expect(a.teams).toEqual([{ membership_id: aliceM, league: 'League A', team: 'alice', season: '2026-27' }]);
    expect(a.donations).toEqual({ count: 2, dollars: 12.5 });
    expect(users[1]).toMatchObject({ athlete: null, donations: { count: 0, dollars: 0 } });
    expect(users[2].roles).toEqual(['admin']);
    expect(users[3].roles).toEqual(['stat_keeper']);
  });

  it('refuses a non-admin', async () => {
    await expect(list(alice)).rejects.toThrow('FORBIDDEN');
    await expect(list(keeper)).rejects.toThrow('FORBIDDEN');
  });
});

describe('admin_remove_user', () => {
  it('keeps team, donations, pairings; unlinks athlete', async () => {
    await as(f.db, f.admin, async (tx) => {
      await rpc(tx, 'link_athlete_user', { p_athlete: A(3), p_user: alice });
      await rpc(tx, 'record_donation', { p_membership: aliceM, p_dollars: 5, p_note: null });
    });
    await settle();
    await open();
    const donations = await count(`public.credit_ledger where membership_id = $1 and kind = 'donation'`, [aliceM]);
    const ledger = await count('public.credit_ledger where membership_id = $1', [aliceM]);
    const slots = await count('public.roster_slots where membership_id = $1', [aliceM]);

    expect(await removeUser(alice)).toEqual({ teams: 1, donations: 1 });

    expect(await count('auth.users where id = $1', [alice])).toBe(0);
    expect(await count('public.profiles where id = $1', [alice])).toBe(0);
    const m = (await f.db.query<{ user_id: string | null; removed: boolean; team_name: string }>(
      'select user_id, removed_at is not null as removed, team_name from public.memberships where id = $1', [aliceM])).rows[0];
    expect(m).toEqual({ user_id: null, removed: true, team_name: 'alice' });
    expect(donations).toBe(1);
    expect(await count(`public.credit_ledger where membership_id = $1 and kind = 'donation'`, [aliceM])).toBe(1);
    expect(await count('public.credit_ledger where membership_id = $1', [aliceM])).toBe(ledger);
    expect(await count('public.game_pairings where home = $1', [aliceM])).toBe(1);
    expect(await count('public.roster_slots where membership_id = $1', [aliceM])).toBe(slots); // settled buys stay
    expect(await count('public.athletes where id = $1 and user_id is null', [A(3)])).toBe(1);
    expect((await audit('admin_remove_user'))[0].details).toEqual({
      user: alice, email: 'alice@x.test', display_name: 'alice', teams: ['alice'], donations: 1 });
  });

  it("deletes the removed team's buys for stages not yet settled and its pending outbox rows", async () => {
    await grant(f);
    await openAuction(f);
    await bid(f, alice, aliceM, A(0), 20);
    await bid(f, bob, bobM, A(2), 15);
    await f.db.query('select private.queue_bid_reminders()');
    await f.db.query(`update private.outbox set sent_at = now() where membership_id = $1`, [bobM]);
    await f.db.query(`insert into private.outbox (membership_id, kind, ref, subject, body) values ($1, 'test', 'x', 's', 'b')`, [bobM]);
    expect(await count('private.outbox where membership_id = $1 and sent_at is null', [aliceM])).toBeGreaterThan(0);

    await removeUser(alice);

    expect(await count('public.bids where membership_id = $1', [aliceM])).toBe(0);
    expect(await count('public.bids where membership_id = $1', [bobM])).toBe(1);
    expect(await count('private.outbox where membership_id = $1', [aliceM])).toBe(0);
    expect(await count('private.outbox where membership_id = $1', [bobM])).toBe(2); // bob's sent and unsent both stay
  });

  it('works for someone who tallied', async () => {
    const session = (await as(f.db, keeper, (tx) => rpc(tx, 'create_session', {
      p_season: f.season, p_kind: 'practice', p_held_on: '2026-11-16', p_counts: true }))) as string;
    await as(f.db, keeper, (tx) => rpc(tx, 'save_taps', {
      p_session: session, p_client_now: new Date().toISOString(), p_taps: [tap(A(0), 'goal', new Date().toISOString())] }));
    expect(await removeUser(keeper)).toEqual({ teams: 0, donations: 0 });
    expect(await count('public.stat_taps where keeper_id is null')).toBe(1);
    expect(await count('auth.users where id = $1', [keeper])).toBe(0);
  });

  it('refuses yourself, an unknown id and a non-admin', async () => {
    await expect(removeUser(f.admin)).rejects.toThrow('CANNOT_REMOVE_SELF');
    await expect(removeUser(crypto.randomUUID())).rejects.toThrow('NOT_FOUND');
    await expect(removeUser(bob, alice)).rejects.toThrow('FORBIDDEN');
  });
});

describe('removed-team rules', () => {
  it('check_pairings accepts pairings without the removed team', async () => {
    const [carol, carolM] = await member(f.db, 'carol');
    await expect(open()).rejects.toThrow('PAIRINGS_INVALID'); // carol is a live team and missing from the pairings
    const all = [...pairings(), { league_id: f.league, home: carolM, away: null }];
    const game = (await as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: all }))) as string;
    await start(game);
    await removeUser(carol);
    const finish = (p: unknown) => as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: p, p_provisional: {} }));
    await expect(finish(all)).rejects.toThrow('PAIRINGS_INVALID');
    await finish(pairings());
    expect(await count('public.games where stage_id = $1', [f.stage])).toBe(2);
  });

  it('join after removal: spot is free, same team name still taken', async () => {
    const g = await auctionFixture(2, { max_members: 2 });
    await member(g.db, 'ann');
    const [bobId] = await member(g.db, 'bob');
    const dave = await createUser(g.db, 'dave@x.test');
    await as(g.db, dave, (tx) => rpc(tx, 'set_display_name', { p_name: 'dave' }));
    const join = (name: string) => as(g.db, dave, (tx) => rpc(tx, 'join_league', { p_code: 'LEAGUE1', p_team_name: name }));
    await expect(join('dave')).rejects.toThrow('LEAGUE_FULL');
    await as(g.db, g.admin, (tx) => rpc(tx, 'admin_remove_user', { p_user: bobId }));
    await expect(join('bob')).rejects.toThrow('TEAM_NAME_TAKEN');
    await join('dave');
  });

  it('join_open_league: a removed team frees its spot too', async () => {
    const g = await auctionFixture(2, { max_members: 2 });
    const user = async (name: string) => {
      const id = await createUser(g.db, `${name}@x.test`);
      await as(g.db, id, (tx) => rpc(tx, 'set_display_name', { p_name: name }));
      return id;
    };
    const [one, two, three] = [await user('one'), await user('two'), await user('three')];
    const lid = (await as(g.db, one, (tx) => rpc(tx, 'create_my_league', { p_name: 'Open', p_password: 'pw12', p_team_name: 'One' }))) as string;
    const join = (who: string, team: string) =>
      as(g.db, who, (tx) => rpc(tx, 'join_open_league', { p_league: lid, p_password: 'pw12', p_team_name: team }));
    await join(two, 'Two');
    await expect(join(three, 'Three')).rejects.toThrow('LEAGUE_FULL');
    await as(g.db, g.admin, (tx) => rpc(tx, 'admin_remove_user', { p_user: two }));
    await join(three, 'Three');
  });

  it('list_leagues counts live teams only', async () => {
    const teams = async () => (await as(f.db, bob, (tx) => tx.query<{ teams: number }>(
      'select teams from public.list_leagues()'))).rows[0].teams;
    expect(await teams()).toBe(2);
    await removeUser(alice);
    expect(await teams()).toBe(1);
  });
});

describe('removed teams get no email', () => {
  it('queues no bid reminder for a removed team', async () => {
    await grant(f);
    await openAuction(f, new Date(Date.now() + 23 * 3_600_000).toISOString());
    await removeUser(alice);
    await f.db.query('select private.queue_bid_reminders()');
    const rows = await f.db.query<{ membership_id: string }>('select membership_id from private.outbox');
    expect(rows.rows.map((r) => r.membership_id)).toEqual([bobM]);
  });

  it('queues no pick notice for a removed team', async () => {
    const [, carolM] = await member(f.db, 'carol');
    await settle();
    await f.db.query(`insert into public.roster_slots (stage_id, membership_id, league_id, athlete_id, price, via)
      values ($1, $2, $3, $4, 10, 'bid')`, [f.stage, carolM, f.league, A(4)]); // so carol owes a pick
    await removeUser(alice);
    await as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: [{ league_id: f.league, home: bobM, away: carolM }] }));
    const rows = await f.db.query<{ membership_id: string }>(`select membership_id from private.outbox where kind = 'pick_next'`);
    expect(rows.rows.map((r) => r.membership_id).sort()).toEqual([bobM, carolM].sort());
  });
});

describe('donation_leaderboard', () => {
  it('shows a removed donor as "Removed user"', async () => {
    await as(f.db, f.admin, async (tx) => {
      await rpc(tx, 'record_donation', { p_membership: aliceM, p_dollars: 10, p_note: null });
      await rpc(tx, 'record_donation', { p_membership: bobM, p_dollars: 5, p_note: null });
    });
    await removeUser(alice);
    const board = async (who: string) => (await as(f.db, who, (tx) => tx.query<{ name: string | null; dollars: number; is_me: boolean }>(
      'select name, dollars::float8 as dollars, is_me from public.donation_leaderboard($1)', [f.season]))).rows;
    expect(await board(bob)).toEqual([
      { name: 'Removed user', dollars: 10, is_me: false },
      { name: 'bob', dollars: 5, is_me: true }]);
    expect((await board(f.admin)).every((r) => !r.is_me)).toBe(true);
  });
});

describe('sealed access', () => {
  const read = (who: string, table: string) =>
    as(f.db, who, async (tx) => (await tx.query<{ n: number }>(`select count(*)::int as n from public.${table}`)).rows[0].n);

  it('admin reads bids before close and picks before the game starts; a keeper does not', async () => {
    await grant(f);
    await openAuction(f);
    await bid(f, alice, aliceM, A(0), 20);
    expect(await read(f.admin, 'bids')).toBe(1);
    expect(await read(keeper, 'bids')).toBe(0);
    expect(await read(alice, 'bids')).toBe(1);
    expect(await read(bob, 'bids')).toBe(0);

    await closeBids(f);
    await runAuction(f);
    await pick(aliceM, 1, [A(0)]);
    expect(await read(f.admin, 'game_picks')).toBe(1);
    expect(await read(keeper, 'game_picks')).toBe(0);
    expect(await read(bob, 'game_picks')).toBe(0);
    expect(await read(alice, 'game_picks')).toBe(1);
  });
});
