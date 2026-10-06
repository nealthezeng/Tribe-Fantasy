// t213: admins rename a season, or delete one with everything in it; a season with donation receipts is refused.
import { beforeEach, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, bid, closeBids, grant, member, openAuction, runAuction, type AuctionFixture } from './auction-fixture';
import { makeKeeper, tap } from './stats-fixture';

let f: AuctionFixture;
let alice: string, aliceM: string, bobM: string;

const count = async (sql: string, args: unknown[] = []) =>
  (await f.db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, args)).rows[0].n;
const del = (season: string, who = f.admin) => as(f.db, who, (tx) => rpc(tx, 'delete_season', { p_season: season }));
const rename = (season: string, name: string, who = f.admin) =>
  as(f.db, who, (tx) => rpc(tx, 'rename_season', { p_season: season, p_name: name }));

beforeEach(async () => {
  f = await auctionFixture(8);
  [alice, aliceM] = await member(f.db, 'alice');
  [, bobM] = await member(f.db, 'bob');
});

describe('rename_season', () => {
  it('renames, trims, and audits the old and new name', async () => {
    await rename(f.season, '  Fall 2026  ');
    expect((await f.db.query<{ name: string }>('select name from public.seasons where id = $1', [f.season])).rows[0].name).toBe('Fall 2026');
    const audit = await f.db.query<{ details: Record<string, string> }>(`select details from public.audit_log where action = 'rename_season'`);
    expect(audit.rows[0].details).toEqual({ old: '2026-27', new: 'Fall 2026' });
  });

  it('refuses a blank or too-long name, an unknown season, and non-admins', async () => {
    await expect(rename(f.season, '   ')).rejects.toThrow('INVALID_NAME');
    await expect(rename(f.season, 'x'.repeat(61))).rejects.toThrow('INVALID_NAME');
    await expect(rename('00000000-0000-0000-0000-000000000000', 'X')).rejects.toThrow('NOT_FOUND');
    await expect(rename(f.season, 'Mine', alice)).rejects.toThrow('FORBIDDEN');
  });
});

describe('delete_season', () => {
  it('deletes everything in the season, leaves other seasons alone, and audits a summary', async () => {
    const keeper = await createUser(f.db, 'keeper@x.test');
    await makeKeeper(f.db, keeper);
    const other = (await as(f.db, f.admin, (tx) => rpc(tx, 'create_season', { p_name: 'Other', p_settings: {} }))) as string;
    await as(f.db, f.admin, (tx) => rpc(tx, 'add_athlete', { p_season: other, p_name: 'Keep me', p_user: null }));
    await grant(f);
    await openAuction(f);
    await bid(f, alice, aliceM, f.athletes[0], 5);
    await closeBids(f);
    await runAuction(f);
    const game = (await as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament',
      { p_stage: f.stage, p_pairings: [{ league_id: f.league, home: aliceM, away: bobM }] }))) as string;
    const sid = (await as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game }))) as string;
    const now = new Date().toISOString();
    await as(f.db, keeper, (tx) => rpc(tx, 'save_taps', { p_session: sid, p_client_now: now, p_taps: [tap(f.athletes[0], 'goal', now)] }));
    const ledger = await count('public.credit_ledger');
    expect(ledger).toBeGreaterThan(0);

    await del(f.season);

    for (const t of ['stages', 'leagues', 'memberships', 'credit_ledger', 'bids', 'roster_slots', 'games', 'game_pairings',
      'sessions', 'stat_taps', 'invites']) {
      expect(await count(`public.${t}`), t).toBe(0);
    }
    expect(await count('public.seasons')).toBe(1);
    expect(await count('public.athletes where season_id = $1', [other])).toBe(1);
    expect(await count('public.athletes')).toBe(1);
    const audit = await f.db.query<{ details: Record<string, unknown> }>(`select details from public.audit_log where action = 'delete_season'`);
    expect(audit.rows[0].details).toMatchObject({ name: '2026-27', stages: 1, leagues: 1, memberships: 2, athletes: 8, games: 1,
      sessions: 1, ledger_rows: ledger });
  });

  it('refuses a season with a donation receipt and keeps it whole', async () => {
    await f.db.query(`update public.seasons set settings = settings || '{"donations_enabled": true}' where id = $1`, [f.season]);
    await as(f.db, f.admin, (tx) => rpc(tx, 'record_donation', { p_membership: aliceM, p_dollars: 5, p_note: null }));
    await expect(del(f.season)).rejects.toThrow('SEASON_HAS_DONATIONS');
    expect(await count('public.seasons')).toBe(1);
    expect(await count('public.memberships')).toBe(2);
  });

  it('refuses an unknown season and non-admins', async () => {
    await expect(del('00000000-0000-0000-0000-000000000000')).rejects.toThrow('NOT_FOUND');
    await expect(del(f.season, alice)).rejects.toThrow('FORBIDDEN');
    await expect(del(f.season, null as unknown as string)).rejects.toThrow();
    expect(await count('public.seasons')).toBe(1);
  });
});
