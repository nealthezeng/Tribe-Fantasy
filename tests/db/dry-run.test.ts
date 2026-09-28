// M8 full dry run (board t36): six fake managers play one stage end to end on the real migrations, then the
// app's own loader mapping (toYearInput) and scoreYear score it. Prints the standings for a hand check.
import { beforeAll, describe, expect, it } from 'vitest';
import { as, createUser, rpc } from './helpers';
import { auctionFixture, bid, closeBids, grant, injure, member, openAuction, runAuction, type AuctionFixture } from './auction-fixture';
import { makeKeeper, tap } from './stats-fixture';
import { stageAllowance } from '../../src/core/points';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { scoreYear, type YearResult } from '../../src/core/year';
import { toYearInput, type LeagueRows } from '../../src/app/lib/weekly';

let f: AuctionFixture;
let teams: { uid: string; mid: string; name: string }[];
let keeper: string, verifier: string;
let result: YearResult;
let rows: LeagueRows;
const NOW = Date.parse('2027-01-01T00:00:00Z'); // long after the stage: everything final
const START = 115; // everyone ties before the first week: (100 + 130) / 2

const q = async <T,>(sql: string, params: unknown[] = []) => (await f.db.query<T>(sql, params)).rows;
const iso = (col: string) => `to_json(${col}) #>> '{}' as ${col.split('.').pop()}`;

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

  // Four weeks (Sun Oct 18, then three Mon–Sun). Picks lock in an hour while we pick, then go back.
  expect(await as(f.db, f.admin, (tx) => rpc(tx, 'create_stage_weeks', { p_stage: f.stage }))).toBe(4);
  const weeks = await q<{ id: string; starts_on: string; lock: string }>(
    `select id, starts_on::text, pick_lock_at::text as lock from public.weeks where stage_id = $1 order by starts_on`, [f.stage]);
  const roster = async (mid: string) => (await q<{ athlete_id: string }>(
    'select athlete_id from public.roster_slots where membership_id = $1 order by athlete_id', [mid])).map((r) => r.athlete_id);
  const rosters = await Promise.all(teams.map((t) => roster(t.mid)));
  const injuredPick = rosters[1][1]; // Ben's pick in week 3 (weeks[2]) gets hurt before the lock
  for (const [w, week] of weeks.slice(1).entries()) {
    await f.db.query(`update public.weeks set pick_lock_at = now() + interval '1 hour' where id = $1`, [week.id]);
    for (const [i, t] of teams.entries()) {
      if (w === 2 && i === 2) continue; // Cal forgets week 4
      await as(f.db, t.uid, (tx) => rpc(tx, 'set_pick', { p_membership: t.mid, p_week: week.id, p_athlete: rosters[i][w] }));
    }
    await f.db.query(`update public.weeks set pick_lock_at = $2 where id = $1`, [week.id, week.lock]);
  }
  const week3 = weeks[2];
  await f.db.query(`insert into public.injuries (athlete_id, confirmed_at, cleared_at)
    values ($1, $2::timestamptz - interval '1 day', $2::timestamptz + interval '10 days')`, [injuredPick, week3.lock]);

  // Stats: a Tuesday practice each full week and the closing tournament, tallied by one keeper, verified by another.
  const days = ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-07'];
  for (const [s, held] of days.entries()) {
    const kind = held === '2026-11-07' ? 'tournament' : 'practice';
    const session = (await as(f.db, keeper, (tx) =>
      rpc(tx, 'create_session', { p_season: f.season, p_kind: kind, p_held_on: held, p_counts: true }))) as string;
    const lines: { athlete_id: string; stats: Record<string, number> }[] = [];
    const taps: ReturnType<typeof tap>[] = [];
    for (const [i, a] of f.athletes.slice(0, 24).entries()) {
      if (a === injuredPick && held === '2026-10-27') continue; // hurt that week: no line
      const stats = { goal: (i + s) % 3, assist: (i * 7 + s) % 2, turnover: (i + s) % 2 };
      if (!Object.values(stats).some(Boolean)) continue;
      lines.push({ athlete_id: a, stats });
      const at = new Date().toISOString();
      for (const [stat, n] of Object.entries(stats)) for (let k = 0; k < n; k++) taps.push(tap(a, stat, at));
    }
    await as(f.db, keeper, (tx) => rpc(tx, 'save_taps', { p_session: session, p_client_now: new Date().toISOString(), p_taps: taps }));
    await as(f.db, verifier, (tx) => rpc(tx, 'verify_session', { p_session: session, p_lines: lines }));
    await f.db.query(`update public.sessions set verified_at = held_on + interval '1 day' where id = $1`, [session]);
  }

  // Rows the way loadLeagueRows reads them, through the app's own mapping.
  rows = {
    settings: (await q<{ settings: unknown }>('select settings from public.seasons where id = $1', [f.season]))[0].settings,
    stages: await q('select id, name from public.stages where season_id = $1', [f.season]),
    weeks: await q(`select id, stage_id, starts_on::text, ends_on::text, ${iso('starts_at')}, ${iso('ends_at')},
      ${iso('pick_lock_at')} from public.weeks order by starts_on`),
    members: await q(`select id, team_name, ${iso('created_at')} from public.memberships where league_id = $1`, [f.league]),
    slots: await q('select stage_id, membership_id, athlete_id from public.roster_slots'),
    picks: await q('select week_id, membership_id, athlete_id from public.picks'),
    sessions: await q(`select id, kind, held_on::text, counts, ${iso('verified_at')} from public.sessions`),
    lines: await q('select session_id, athlete_id, stats, points_played from public.stat_lines'),
    injuries: await q(`select athlete_id, ${iso('confirmed_at')}, ${iso('cleared_at')} from public.injuries`),
    athletes: await q('select id, name from public.athletes where season_id = $1', [f.season]),
  };
  result = scoreYear(toYearInput(rows, NOW));
}, 120_000);

const team = (mid: string) => teams.find((t) => t.mid === mid)!.name;

describe('dry run: one stage, six managers', () => {
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

  it('scored the weeks: skipped Sunday, then three final weeks where everyone played once a week', () => {
    expect(result.weeks.map((w) => w.status)).toEqual(['skipped', 'final', 'final', 'final']);
    for (const s of result.standings) {
      expect(Number.isFinite(s.points)).toBe(true);
      expect(s.wins + s.losses + s.ties).toBe(3);
    }
  });

  it('swapped the injured pick and filled the missed one, with notices', () => {
    const side = (w: number, mid: string) =>
      result.weeks[w].matchups.flatMap((m) => [m.home, m.away]).find((x) => x?.membershipId === mid)!;
    const ben = side(2, teams[1].mid);
    expect(ben.notice).toBe('injured');
    expect(ben.athleteId).not.toBe(ben.picked);
    const cal = side(3, teams[2].mid);
    expect(cal.notice).toBe('missed');
    expect(cal.athleteId).not.toBeNull();
  });

  it('is deterministic', () => {
    expect(scoreYear(toYearInput(rows, NOW))).toEqual(result);
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
