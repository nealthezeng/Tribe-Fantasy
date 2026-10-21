// Replay (M15 P5): 0027 clears every open injury, and a game that already started must keep scoring exactly as before.
// The DB is built up to 0026, one game is played with an OPEN confirmed injury on a picked player, then 0027 runs.
import { describe, expect, it } from 'vitest';
import { as, migrationSql, rpc } from './helpers';
import { auctionFixture, bid, closeBids, grant, member, openAuction, readLeagueRows, runAuction } from './auction-fixture';
import { makeKeeper, tap } from './stats-fixture';
import { buildLeagueTournament, leaguePairingInput, toPairings, toTournamentInput } from '../../src/app/lib/tournament';
import { scoreTournaments } from '../../src/core/tournament';

describe('0027 over a database with a played game', () => {
  it('leaves every played game scoring exactly as before', async () => {
    const f = await auctionFixture(6, { picks_per_game: 1 }, '0027');
    const q = async <T,>(sql: string, params: unknown[] = []) => (await f.db.query<T>(sql, params)).rows;
    // The tournament runs now (Eastern dates, as CI is UTC).
    await f.db.query(`update public.stages set starts_on = (now() at time zone 'America/New_York')::date - 1,
      ends_on = (now() at time zone 'America/New_York')::date + 30 where id = $1`, [f.stage]);
    const teams = [await member(f.db, 'Ava'), await member(f.db, 'Ben')];
    const keeper = (await member(f.db, 'Kay'))[0], verifier = (await member(f.db, 'Vee'))[0];
    await makeKeeper(f.db, keeper);
    await makeKeeper(f.db, verifier);

    await grant(f);
    await openAuction(f);
    for (const [i, [uid, mid]] of teams.entries()) {
      await bid(f, uid, mid, f.athletes[2 * i], 10);
      await bid(f, uid, mid, f.athletes[2 * i + 1], 10);
    }
    await closeBids(f);
    await runAuction(f);

    const pairNext = async () => {
      const provisional = [leaguePairingInput(f.league, toTournamentInput(await readLeagueRows(f), Date.now()))];
      return { pairings: provisional.flatMap(toPairings), provisional };
    };
    const first = await pairNext();
    await as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: first.pairings, p_games: 2 }));
    const [a0, a1, a2] = f.athletes;
    const pick = (t: [string, string], athlete: string) => as(f.db, t[0], (tx) =>
      rpc(tx, 'set_game_pick', { p_membership: t[1], p_stage: f.stage, p_number: 1, p_athletes: `{${athlete}}` }));
    await pick(teams[0], a0);
    await pick(teams[1], a2);
    // A0 has an OPEN confirmed injury when game 1 starts, and it stays open after.
    await f.db.query(`insert into public.injuries (athlete_id, confirmed_at) values ($1, now() - interval '1 minute')`, [a0]);
    const [{ id: game }] = await q<{ id: string }>('select id from public.games where stage_id = $1 and number = 1', [f.stage]);
    const session = (await as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game }))) as string;
    const at = new Date().toISOString();
    const lines = [a1, a2].map((athlete_id) => ({ athlete_id, stats: { goal: 2 } }));
    const taps = lines.flatMap((l) => [tap(l.athlete_id, 'goal', at), tap(l.athlete_id, 'goal', at)]);
    await as(f.db, keeper, (tx) => rpc(tx, 'save_taps', { p_session: session, p_client_now: at, p_taps: taps }));
    const next = await pairNext();
    await as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: next.pairings, p_provisional: next.provisional }));
    await as(f.db, verifier, (tx) => rpc(tx, 'verify_session', { p_session: session, p_lines: lines }));
    await f.db.query(`update public.sessions set verified_at = now() - interval '30 days' where id = $1`, [session]);

    const now = Date.now();
    const before = scoreTournaments(toTournamentInput(await readLeagueRows(f), now)); // no outs table yet
    expect(before.games[0].status).toBe('final');
    expect((await q('select 1 from public.injuries where cleared_at is null'))).toHaveLength(1);

    await f.db.exec(migrationSql('0027_out.sql'));

    const rows = await readLeagueRows(f);
    expect(rows.outs).toEqual([]);
    const after = scoreTournaments(toTournamentInput(rows, now));
    expect(after.games).toEqual(before.games);
    expect(after.standings).toEqual(before.standings);
    const side = after.games[0].matchups.flatMap((m) => [m.home, m.away]).find((s) => s?.membershipId === teams[0][1])!;
    expect(side.replacements).toEqual([{ picked: a0, athleteId: a1, why: 'out' }]);
    expect(await q('select 1 from public.injuries where cleared_at is null')).toEqual([]);
    // Game 2 is next, and A0 is not Out for it.
    const y = buildLeagueTournament(rows, now);
    expect(y.result.next).toMatchObject({ number: 2 });
    expect(y.out.has(a0)).toBe(false);
  }, 120_000);
});
