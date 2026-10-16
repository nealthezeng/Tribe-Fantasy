// Full dry run (M8 board t36, tournament mode since T3, shares since M13): six fake managers buy shares and play one
// stage's 2v2 tournament end to end on the real migrations. Pairings come from the app's own path (rows as
// loadLeagueRows reads them → toTournamentInput → pairingInputs), and scoreTournaments scores the result. Prints the
// standings for a hand check.
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, bid, closeBids, grant, member, openAuction, runAuction, type AuctionFixture } from './auction-fixture';
import { makeKeeper, tap } from './stats-fixture';
import { stageAllowance } from '../../src/core/points';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { pairingInputs, rosterOf, scoreTournaments, type TournamentInput, type TournamentResult } from '../../src/core/tournament';
import { checkPairing, toPairings, toTournamentInput, type TournamentRows } from '../../src/app/lib/tournament';

let f: AuctionFixture;
let teams: { uid: string; mid: string; name: string }[];
let keeper: string, verifier: string;
let result: TournamentResult;
let rows: Rows;
const NOW = Date.parse('2027-01-01T00:00:00Z'); // after every game's verified_at (set below), so all three played games are final
const START = 115; // everyone ties before the first game: (100 + 130) / 2

const q = async <T,>(sql: string, params: unknown[] = []) => (await f.db.query<T>(sql, params)).rows;
const iso = (col: string) => `to_json(${col}) #>> '{}' as ${col.split('.').pop()}`;

type Slot = { stage_id: string; membership_id: string; athlete_id: string; price: number; share: number };
type Rows = Omit<TournamentRows, 'slots' | 'swaps'> & { slots: Slot[] };

/** Every row the way loadLeagueRows reads them for staff (with live taps). */
const readRows = async (): Promise<Rows> => ({
  settings: (await q<{ settings: unknown }>('select settings from public.seasons where id = $1', [f.season]))[0].settings,
  stages: await q(`select id, name, starts_on::text, ends_on::text, ${iso('bid_close_at')}, auction_seed, ${iso('auction_run_at')}
    from public.stages where season_id = $1`, [f.season]),
  games: await q(`select id, stage_id, number, session_id, ${iso('started_at')}, ${iso('finished_at')} from public.games`),
  pairings: await q('select game_id, home, away from public.game_pairings where league_id = $1', [f.league]),
  members: await q(`select id, team_name, ${iso('created_at')} from public.memberships where league_id = $1`, [f.league]),
  slots: await q('select stage_id, membership_id, athlete_id, price, share::float8 as share from public.roster_slots'),
  picks: await q('select stage_id, game_number, membership_id, athlete_id from public.game_picks'),
  sessions: await q(`select id, ${iso('verified_at')} from public.sessions where id in (select session_id from public.games)`),
  lines: await q('select session_id, athlete_id, stats, points_played from public.stat_lines'),
  taps: await q(`select id, session_id, athlete_id, stat, keeper_id, ${iso('tapped_at')}, undoes from public.stat_taps`),
  injuries: await q(`select athlete_id, ${iso('confirmed_at')}, ${iso('cleared_at')} from public.injuries`),
  athletes: await q('select id, name from public.athletes where season_id = $1', [f.season]),
});

// ponytail: toTournamentInput (src/app/lib/tournament.ts) reads bench and swaps and drops share until T5 moves it to
// shares. Feed it the old shape and put the shares back; once T5 lands this is just toTournamentInput(rows, now).
const inputOf = (r: Rows, now: number): TournamentInput => {
  const legacy = { ...r, slots: r.slots.map((x) => ({ ...x, bench: false })), swaps: [] };
  return {
    ...toTournamentInput(legacy as unknown as TournamentRows, now),
    slots: r.slots.map((x) => ({ stageId: x.stage_id, membershipId: x.membership_id, athleteId: x.athlete_id, price: x.price, share: x.share })),
  };
};

/** The next game's pairings and their inputs, as the finishing keeper's phone computes them. */
const pairNext = async () => {
  const provisional = [{ league_id: f.league, ...pairingInputs(inputOf(await readRows(), Date.now())) }];
  return { pairings: provisional.flatMap(toPairings), provisional };
};
/** A Postgres array literal: the rpc helper sends arrays as JSON (PostgREST converts them itself). */
const pick = (t: { uid: string; mid: string }, n: number, athletes: string[]) => as(f.db, t.uid, (tx) =>
  rpc(tx, 'set_game_pick', { p_membership: t.mid, p_stage: f.stage, p_number: n, p_athletes: `{${athletes.join(',')}}` }));

beforeAll(async () => {
  f = await auctionFixture(16);
  // The tournament runs now (Eastern dates, as CI is UTC): pairing counts this tournament's meetings only while its
  // dates last.
  await f.db.query(`update public.stages set starts_on = (now() at time zone 'America/New_York')::date - 1,
    ends_on = (now() at time zone 'America/New_York')::date + 30 where id = $1`, [f.stage]);
  teams = [];
  for (const name of ['Ava', 'Ben', 'Cal', 'Dee', 'Eli', 'Fay']) {
    const [uid, mid] = await member(f.db, name);
    teams.push({ uid, mid, name });
  }
  keeper = await createUser(f.db, 'keeper@x.test');
  verifier = await createUser(f.db, 'verifier@x.test');
  await makeKeeper(f.db, keeper);
  await makeKeeper(f.db, verifier);

  // Credits and sealed share buying: every team buys two players of its own, Ava and Cal split A0, Ben overspends.
  await grant(f);
  await openAuction(f);
  for (const [i, t] of teams.entries()) {
    await bid(f, t.uid, t.mid, f.athletes[3 + i], 10 + i);
    await bid(f, t.uid, t.mid, f.athletes[9 + i], 20);
  }
  await bid(f, teams[0].uid, teams[0].mid, f.athletes[0], 50);
  await bid(f, teams[2].uid, teams[2].mid, f.athletes[0], 25);
  // Ben overspends. place_bid refuses a total over the balance since M8.5, so these are direct writes: they exercise
  // run_auction's C5 drop, the safety net for a balance lowered while buying. Ben keeps A1 (100) and A4 (11) only.
  for (const [athlete, amount] of [[f.athletes[1], 100], [f.athletes[2], 99]] as const) {
    await f.db.query(`insert into public.bids (stage_id, membership_id, league_id, athlete_id, amount) values ($1, $2, $3, $4, $5)`,
      [f.stage, teams[1].mid, f.league, athlete, amount]);
  }
  await closeBids(f);
  expect(await runAuction(f)).toEqual({ by_bid: 14, empty: 6 * 6 - 14 });

  // The 2v2 tournament: game 1 paired by the (all tied) standings, then three games. Fay picks one player for game 1,
  // Ava's A0 is hurt at the start of game 2, Dee starts her only two players every game (tired), Cal forgets game 3.
  const first = await pairNext();
  await as(f.db, f.admin, (tx) => rpc(tx, 'open_tournament', { p_stage: f.stage, p_pairings: first.pairings }));
  const sessionLines = new Map<string, { athlete_id: string; stats: Record<string, number> }[]>();
  for (const n of [1, 2, 3]) {
    const input = inputOf(await readRows(), Date.now());
    for (const [i, t] of teams.entries()) {
      if (n === 3 && i === 2) continue;
      const roster = rosterOf(input, t.mid, f.stage);
      const mine = i === 0 && n === 2 ? [f.athletes[0], f.athletes[3]] : n === 3 ? roster.slice(-2) : roster.slice(0, 2);
      await pick(t, n, i === 5 && n === 1 ? mine.slice(0, 1) : mine);
    }
    if (n === 2) {
      await f.db.query(`insert into public.injuries (athlete_id, confirmed_at) values ($1, now() - interval '1 minute')`, [f.athletes[0]]);
    }
    const [{ id: game }] = await q<{ id: string }>('select id from public.games where stage_id = $1 and number = $2', [f.stage, n]);
    const session = (await as(f.db, keeper, (tx) => rpc(tx, 'start_game', { p_game: game }))) as string;
    // A0 recovers after the start.
    await f.db.query('update public.injuries set cleared_at = now() where cleared_at is null');

    // Stats for every player, tallied by one keeper.
    const taps: ReturnType<typeof tap>[] = [];
    const lines: { athlete_id: string; stats: Record<string, number> }[] = [];
    for (const [i, a] of f.athletes.entries()) {
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
  result = scoreTournaments(inputOf(rows, NOW));
}, 120_000);

const team = (mid: string) => teams.find((t) => t.mid === mid)!.name;
const sideOf = (n: number, mid: string) =>
  result.games.find((g) => g.game.number === n)!.matchups.flatMap((m) => [m.home, m.away]).find((x) => x?.membershipId === mid)!;

describe('dry run: one tournament, six managers', () => {
  it('settled the shares: A0 split 2/3 and 1/3, Ben\'s overspend dropped, every credit charged, none overspent', async () => {
    const slots = rows.slots;
    expect(slots).toHaveLength(14);
    const a0 = slots.filter((x) => x.athlete_id === f.athletes[0]).map((x) => [team(x.membership_id), x.price, x.share]).sort();
    expect(a0).toEqual([['Ava', 50, expect.closeTo(2 / 3, 6)], ['Cal', 25, expect.closeTo(1 / 3, 6)]]);
    expect(slots.filter((x) => x.membership_id === teams[1].mid).map((x) => x.athlete_id).sort())
      .toEqual([f.athletes[1], f.athletes[4]].sort());
    expect(slots.find((x) => x.athlete_id === f.athletes[3])?.share).toBe(10 / 20); // a lone buy under min_shares
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

  it('started two per side, filling the missed and injured picks and tiring the repeats', () => {
    const fay = sideOf(1, teams[5].mid);
    expect(fay.picked).toHaveLength(1);
    expect(fay.athleteIds).toHaveLength(2);
    expect(fay.replacements).toEqual([{ picked: null, athleteId: expect.any(String), why: 'missed' }]);
    const ava = sideOf(2, teams[0].mid);
    expect(ava.replacements).toEqual([{ picked: f.athletes[0], athleteId: f.athletes[9], why: 'injured' }]);
    expect([...ava.athleteIds].sort()).toEqual([f.athletes[3], f.athletes[9]].sort());
    const cal = sideOf(3, teams[2].mid);
    expect(cal.picked).toEqual([]);
    expect(cal.replacements.map((r) => r.why)).toEqual(['missed', 'missed']);
    expect(cal.athleteIds).toHaveLength(2);
    const dee = sideOf(2, teams[3].mid);
    for (const a of dee.athleteIds) expect(dee.rest[a]).toBe(0.5);
  });

  it('scores each side as the sum of score × share × tiredness × degradation', () => {
    for (const g of result.games.filter((x) => x.status === 'final')) {
      for (const side of g.matchups.flatMap((m) => [m.home, m.away])) {
        if (!side) continue;
        for (const a of side.athleteIds) {
          expect(side.factor[a]).toBeCloseTo(side.share[a] * side.rest[a] * side.decay[a], 9);
          expect(side.points![a]).toBeCloseTo(side.athleteScores![a] * side.factor[a], 9);
        }
        expect(side.score).toBeCloseTo(side.athleteIds.reduce((s, a) => s + side.points![a], 0), 9);
      }
    }
  });

  it('is deterministic', () => {
    expect(scoreTournaments(inputOf(rows, NOW))).toEqual(result);
  });

  it('grants the next stage allowance from these standings, matching the TypeScript formula', async () => {
    const next = (await as(f.db, f.admin, (tx) => rpc(tx, 'create_stage', {
      p_season: f.season, p_name: 'Winter', p_starts_on: '2099-01-01', p_ends_on: '2099-01-21', p_tournament: null }))) as string;
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
