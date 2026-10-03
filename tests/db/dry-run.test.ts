// Full dry run (M8 board t36, tournament mode since T3): six fake managers play one stage's tournament end to end on
// the real migrations. Pairings come from the app's own path (rows as loadLeagueRows reads them → toTournamentInput →
// pairingInputs), and scoreTournaments scores the result. Prints the standings for a hand check.
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, bid, closeBids, grant, injure, member, openAuction, runAuction, type AuctionFixture } from './auction-fixture';
import { makeKeeper, tap } from './stats-fixture';
import { stageAllowance } from '../../src/core/points';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { lineup, pairingInputs, scoreTournaments, type TournamentResult } from '../../src/core/tournament';
import { checkPairing, toPairings, toTournamentInput, type TournamentRows } from '../../src/app/lib/tournament';

let f: AuctionFixture;
let teams: { uid: string; mid: string; name: string }[];
let keeper: string, verifier: string;
let result: TournamentResult;
let rows: TournamentRows;
const NOW = Date.parse('2027-01-01T00:00:00Z'); // long after the stage: everything final
const START = 115; // everyone ties before the first game: (100 + 130) / 2

const q = async <T,>(sql: string, params: unknown[] = []) => (await f.db.query<T>(sql, params)).rows;
const iso = (col: string) => `to_json(${col}) #>> '{}' as ${col.split('.').pop()}`;

/** Every row the way loadLeagueRows reads them for staff (with live taps). */
const readRows = async (): Promise<TournamentRows> => ({
  settings: (await q<{ settings: unknown }>('select settings from public.seasons where id = $1', [f.season]))[0].settings,
  stages: await q(`select id, name, starts_on::text, ${iso('bid_close_at')}, auction_seed, ${iso('auction_run_at')}
    from public.stages where season_id = $1`, [f.season]),
  games: await q(`select id, stage_id, number, session_id, ${iso('started_at')}, ${iso('finished_at')} from public.games`),
  pairings: await q('select game_id, home, away from public.game_pairings where league_id = $1', [f.league]),
  members: await q(`select id, team_name, ${iso('created_at')} from public.memberships where league_id = $1`, [f.league]),
  slots: await q('select stage_id, membership_id, athlete_id, price, bench from public.roster_slots'),
  picks: await q('select stage_id, game_number, membership_id, athlete_id from public.game_picks'),
  swaps: await q('select stage_id, membership_id, out_athlete, in_athlete, from_game from public.bench_swaps'),
  sessions: await q(`select id, ${iso('verified_at')} from public.sessions where id in (select session_id from public.games)`),
  lines: await q('select session_id, athlete_id, stats, points_played from public.stat_lines'),
  taps: await q(`select id, session_id, athlete_id, stat, keeper_id, ${iso('tapped_at')}, undoes from public.stat_taps`),
  injuries: await q(`select athlete_id, ${iso('confirmed_at')}, ${iso('cleared_at')} from public.injuries`),
  athletes: await q('select id, name from public.athletes where season_id = $1', [f.season]),
});

/** The next game's pairings and their inputs, as the finishing keeper's phone computes them. */
const pairNext = async () => {
  const provisional = [{ league_id: f.league, ...pairingInputs(toTournamentInput(await readRows(), Date.now())) }];
  return { pairings: provisional.flatMap(toPairings), provisional };
};

beforeAll(async () => {
  f = await auctionFixture(25); // 24 healthy for 24 slots, so the fill deals every one of them
  teams = [];
  for (const name of ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay']) {
    const [uid, mid] = await member(f.db, name);
    teams.push({ uid, mid, name });
  }
  keeper = await createUser(f.db, 'keeper@x.test');
  verifier = await createUser(f.db, 'verifier@x.test');
  await makeKeeper(f.db, keeper);
  await makeKeeper(f.db, verifier);
  await injure(f, f.athletes[24]); // the fill must never deal A24

  // Credits and a sealed auction: a tie on A0 (Ava bids first), Ben overspends, the rest bid a little.
  await grant(f);
  await openAuction(f);
  await bid(f, teams[0].uid, teams[0].mid, f.athletes[0], 50);
  await bid(f, teams[1].uid, teams[1].mid, f.athletes[0], 50);
  // Same-millisecond placed_at would leave the tie to a random id: make Ava's bid clearly first.
  await f.db.query(`update public.bids set placed_at = placed_at - interval '1 second' where membership_id = $1 and athlete_id = $2`,
    [teams[0].mid, f.athletes[0]]);
  for (const [i, t] of teams.entries()) await bid(f, t.uid, t.mid, f.athletes[3 + i], 10 + i);
  // Ben overspends. place_bid refuses a total over the balance since M8.5, so these are direct writes: they exercise
  // run_auction's affordability skip, the safety net for a balance lowered mid-auction.
  for (const [athlete, amount] of [[f.athletes[1], 100], [f.athletes[2], 100]] as const) {
    await f.db.query(`insert into public.bids (stage_id, membership_id, league_id, athlete_id, amount) values ($1, $2, $3, $4, $5)`,
      [f.stage, teams[1].mid, f.league, athlete, amount]); // A2 is unaffordable after A1
  }
  await closeBids(f);
  expect(await runAuction(f)).toEqual({ by_bid: 8, by_fill: 16, empty: 0 });

  // The tournament: game 1 paired by the (all tied) standings, then three games. Ben's game 2 pick is hurt at its
  // start, Dee starts the same player in games 1 and 2 (tired), Cal forgets game 3.
  const first = await pairNext();
  await as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: first.pairings }));
  const sessionLines = new Map<string, { athlete_id: string; stats: Record<string, number> }[]>();
  for (const n of [1, 2, 3]) {
    const input = toTournamentInput(await readRows(), Date.now());
    for (const [i, t] of teams.entries()) {
      if (n === 3 && i === 2) continue;
      const { active } = lineup(input, t.mid, f.stage, n);
      const athlete = i === 3 && n === 2 ? active[0] : active[(n - 1) % active.length];
      await as(f.db, t.uid, (tx) => rpc(tx, 'set_game_pick', { p_membership: t.mid, p_stage: f.stage, p_number: n, p_athlete: athlete }));
    }
    if (n === 2) {
      const [{ athlete_id: hurt }] = await q<{ athlete_id: string }>(
        'select athlete_id from public.game_picks where membership_id = $1 and game_number = 2', [teams[1].mid]);
      await f.db.query(`insert into public.injuries (athlete_id, confirmed_at) values ($1, now() - interval '1 minute')`, [hurt]);
    }
    const [{ id: game }] = await q<{ id: string }>('select id from public.games where stage_id = $1 and number = $2', [f.stage, n]);
    const session = (await as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game }))) as string;
    // Ben's player recovers after the start (A24 stays out: it was never dealt).
    await f.db.query('update public.injuries set cleared_at = now() where cleared_at is null and athlete_id <> $1', [f.athletes[24]]);

    // Stats for every rostered player, tallied by one keeper.
    const taps: ReturnType<typeof tap>[] = [];
    const lines: { athlete_id: string; stats: Record<string, number> }[] = [];
    for (const [i, a] of f.athletes.slice(0, 24).entries()) {
      const stats = { goal: (i + n) % 3, assist: (i * 7 + n) % 2, turnover: (i + n) % 2 };
      if (!Object.values(stats).some(Boolean)) continue;
      lines.push({ athlete_id: a, stats });
      const at = new Date().toISOString();
      for (const [stat, k] of Object.entries(stats)) for (let j = 0; j < k; j++) taps.push(tap(a, stat, at));
    }
    await as(f.db, keeper, (tx) => rpc(tx, 'save_taps', { p_session: session, p_client_now: new Date().toISOString(), p_taps: taps }));
    const next = await pairNext(); // provisional: this game's live taps count
    await as(f.db, keeper, (tx) => rpc(tx, 'finish_game', { p_game: game, p_pairings: next.pairings, p_provisional: next.provisional }));
    sessionLines.set(session, lines);
  }

  // After the tournament: another keeper verifies every game, and the stats lock.
  for (const [session, lines] of sessionLines) {
    await as(f.db, verifier, (tx) => rpc(tx, 'verify_session', { p_session: session, p_lines: lines }));
  }
  await f.db.query(`update public.sessions set verified_at = '2026-11-08T00:00:00Z' where id in (select session_id from public.games)`);
  rows = await readRows();
  result = scoreTournaments(toTournamentInput(rows, NOW));
}, 120_000);

const team = (mid: string) => teams.find((t) => t.mid === mid)!.name;
const sideOf = (n: number, mid: string) =>
  result.games.find((g) => g.game.number === n)!.matchups.flatMap((m) => [m.home, m.away]).find((x) => x?.membershipId === mid)!;

describe('dry run: one tournament, six managers', () => {
  it('ran the auction: full exclusive rosters, the tie to the first bid, no injured fill, no overspend', async () => {
    const slots = await q<{ membership_id: string; athlete_id: string; price: number }>(
      'select membership_id, athlete_id, price from public.roster_slots');
    expect(slots).toHaveLength(24);
    expect(new Set(slots.map((x) => x.athlete_id)).size).toBe(24);
    expect(slots.some((x) => x.athlete_id === f.athletes[24])).toBe(false);
    expect(slots.find((x) => x.athlete_id === f.athletes[0])?.membership_id).toBe(teams[0].mid);
    expect(slots.some((x) => x.athlete_id === f.athletes[2])).toBe(true); // dealt by the fill instead
    for (const t of teams) expect(slots.filter((x) => x.membership_id === t.mid)).toHaveLength(4);
    const balances = await q<{ membership_id: string; b: number }>(
      'select membership_id, sum(amount)::int as b from public.credit_ledger group by 1');
    for (const r of balances) {
      const spent = slots.filter((x) => x.membership_id === r.membership_id).reduce((s, x) => s + x.price, 0);
      expect(r.b).toBe(START - spent);
      expect(r.b).toBeGreaterThanOrEqual(0);
    }
  });

  it('scored three final games where every team played every game, and paired a fourth', () => {
    expect(result.games.map((g) => g.status)).toEqual(['final', 'final', 'final', 'upcoming']);
    for (const s of result.standings) {
      expect(Number.isFinite(s.points)).toBe(true);
      expect(s.wins + s.losses + s.ties).toBe(3);
    }
  });

  it('paired Swiss without a rematch, and every pairing passes Check pairing', async () => {
    const pairs = await q<{ home: string; away: string }>(`select home, away from public.game_pairings p
      join public.games g on g.id = p.game_id where g.number <= 3`);
    expect(new Set(pairs.map((p) => [p.home, p.away].sort().join())).size).toBe(9);
    const finishes = await q<{ details: Parameters<typeof checkPairing>[0] }>(
      `select details from public.audit_log where action = 'finish_game'`);
    expect(finishes).toHaveLength(3);
    for (const r of finishes) expect(checkPairing(r.details)).toBe(true);
  });

  it('swapped the injured pick, filled the missed one, and tired the repeat', () => {
    const ben = sideOf(2, teams[1].mid);
    expect(ben.notice).toBe('injured');
    expect(ben.athleteId).not.toBe(ben.picked);
    const cal = sideOf(3, teams[2].mid);
    expect(cal.notice).toBe('missed');
    expect(cal.athleteId).not.toBeNull();
    expect(sideOf(2, teams[3].mid)).toMatchObject({ notice: null, tired: 0.5 });
    expect(sideOf(3, teams[0].mid).tired).toBe(1); // Ava cycled through her three actives
  });

  it('is deterministic', () => {
    expect(scoreTournaments(toTournamentInput(rows, NOW))).toEqual(result);
  });

  it('grants the next stage allowance from these standings, matching the TypeScript formula', async () => {
    const next = (await as(f.db, f.admin, (tx) => rpc(tx, 'create_stage', {
      p_season: f.season, p_name: 'Winter', p_starts_on: '2026-11-09', p_ends_on: '2026-11-29', p_tournament: null }))) as string;
    const ranks = Object.fromEntries(result.standings.map((s) => [s.membershipId, s.rank]));
    expect(await as(f.db, f.admin, (tx) => rpc(tx, 'grant_stage_allowance', { p_stage: next, p_ranks: ranks }))).toBe(6);
    const got = await q<{ membership_id: string; amount: number }>(
      `select membership_id, amount from public.credit_ledger where stage_id = $1 and kind = 'allowance'`, [next]);
    for (const g of got) expect(g.amount).toBe(stageAllowance(ranks[g.membership_id], 6, DEFAULT_SETTINGS));

    console.table(result.standings.map((s) => ({
      place: `${s.tied ? 'T' : ''}${s.place}`, team: team(s.membershipId), points: +s.points.toFixed(2),
      'W-L-T': `${s.wins}-${s.losses}-${s.ties}`, score: +s.totalScore.toFixed(2),
      'next allowance': got.find((g) => g.membership_id === s.membershipId)?.amount,
    })));
  });
});
