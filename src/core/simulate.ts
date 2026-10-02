import { allocate, fillLeftovers, type Bid, type ManagerBudget } from './allocation';
import { stageAllowance } from './points';
import { hashSeed, mulberry32 } from './rng';
import { parseSettings, type SeasonSettings } from './settings';
import { nextPairings, scoreTournaments, type TournamentInput, type TournamentResult } from './tournament';
import type { YearStatLine } from './year';

export interface YearSimConfig {
  managers: number;
  athletes: number;
  /** Tournaments in the year; each is one stage with a fresh auction. */
  stages: number;
  gamesPerStage: number;
  seed: string;
  settings?: unknown;
  /** This manager (index) throws the last game of every tournament by starting their worst active athlete. */
  tanker?: number;
  /** This manager (index) ignores tiredness and always starts their best active athlete. */
  repeater?: number;
}

export interface YearSimResult {
  settings: SeasonSettings;
  managerIds: string[];
  /** How far off each manager's read of athlete skill is (lower = sharper). */
  readNoise: Record<string, number>;
  /** Each manager's place (1 = best) at the end of each tournament; the last entry is the final standings. */
  placesByStage: Record<string, number>[];
  input: TournamentInput;
  result: TournamentResult;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const pad = (i: number) => String(i).padStart(2, '0');
const iso = (t: number) => new Date(t).toISOString();
const places = (r: TournamentResult) => Object.fromEntries(r.standings.map((x) => [x.membershipId, x.place]));

/**
 * A whole league year played by fake managers under the real rules, scored by the real scoreTournaments. Each
 * tournament: allowance from the standings so far → one sealed auction (allocate + fill) → each manager benches
 * the athlete they rate worst → games two hours apart, Swiss-paired by `nextPairings`; every manager starts the
 * active athlete with the best read × tiredness. Credits carry over. Tournaments are two weeks apart from 2027-01-09.
 * ponytail: no injuries, swaps, late joiners or missed picks; the DB dry run covers those.
 */
export function simulateYear(cfg: YearSimConfig): YearSimResult {
  const s = parseSettings(cfg.settings ?? {});
  const stream = (name: string) => mulberry32(hashSeed(`${cfg.seed}:${name}`));
  const setup = stream('setup');
  const managerIds = Array.from({ length: cfg.managers }, (_, i) => `m${pad(i)}`);
  const athleteIds = Array.from({ length: cfg.athletes }, (_, i) => `a${pad(i)}`);
  const skill = Object.fromEntries(athleteIds.map((a) => [a, 0.5 + setup()]));
  const readNoise = Object.fromEntries(managerIds.map((m) => [m, 0.05 + 0.6 * setup()]));
  const start = Date.parse('2027-01-09T14:00:00Z'); // a Saturday

  const input: TournamentInput = {
    settings: s, now: 0, games: [], pairings: [], slots: [], picks: [], swaps: [], sessions: [], statLines: [],
    injuries: [], currentStageId: null, members: managerIds.map((id) => ({ id, createdAt: iso(start - 30 * DAY) })),
  };
  const balance = Object.fromEntries(managerIds.map((m) => [m, 0]));
  const placesByStage: Record<string, number>[] = [];

  for (let st = 0; st < cfg.stages; st++) {
    const stageId = `s${pad(st)}`;
    const day1 = start + st * 14 * DAY;

    // Allowance from the standings so far (everyone ties before the first game), granted once the last
    // tournament's stats have locked, as the admin does.
    const sofar = scoreTournaments({ ...input, now: day1 - 5 * DAY });
    for (const row of sofar.standings) balance[row.membershipId] += stageAllowance(row.rank, cfg.managers, s);

    // Sealed auction: each manager bids on the players they rate best, more on the ones they rate higher.
    const read = stream(`read:${st}`);
    const perceived = Object.fromEntries(managerIds.map((m) => [m, Object.fromEntries(athleteIds.map((a) =>
      [a, skill[a] * (1 + readNoise[m] * (read() * 2 - 1))]))]));
    const bids: Bid[] = [];
    for (const m of managerIds) {
      const ranked = [...athleteIds].sort((a, b) => perceived[m][b] - perceived[m][a]);
      const top = ranked.slice(0, s.roster_size).reduce((sum, a) => sum + perceived[m][a], 0);
      ranked.slice(0, s.roster_size * 2).forEach((a, i) => bids.push({
        id: `${stageId}:${m}:${a}`, managerId: m, athleteId: a,
        amount: Math.max(s.min_bid, Math.floor((balance[m] * 0.9 * perceived[m][a]) / top)),
        placedAt: iso(day1 - 4 * DAY + i * 1000 + Math.floor(read() * 999)),
      }));
    }
    const budgets: ManagerBudget[] = managerIds.map((m) => ({ managerId: m, budget: balance[m], openSlots: s.roster_size }));
    const run = allocate(bids, budgets, athleteIds);
    const won = [...run.awards, ...fillLeftovers(run.remaining, run.unclaimed, `${cfg.seed}:${stageId}`)];
    for (const m of managerIds) {
      const mine = won.filter((aw) => aw.managerId === m);
      const benchCount = Math.min(s.bench_size, Math.max(0, mine.length - 1));
      const worst = [...mine].sort((a, b) => perceived[m][a.athleteId] - perceived[m][b.athleteId]).slice(0, benchCount)
        .map((aw) => aw.athleteId);
      for (const aw of mine) {
        balance[m] -= aw.amount;
        input.slots.push({ stageId, membershipId: m, athleteId: aw.athleteId, price: aw.amount, bench: worst.includes(aw.athleteId) });
      }
    }

    // Games: pair, pick (best read × tiredness; the tanker starts their worst in the last game), play, verify.
    const stats = stream(`stats:${st}`);
    for (let n = 1; n <= cfg.gamesPerStage; n++) {
      const startsAt = day1 + (n - 1) * 2 * HOUR;
      const id = `${stageId}g${pad(n)}`;
      for (const [home, away] of nextPairings({ ...input, now: startsAt - HOUR })) {
        input.pairings.push({ gameId: id, home, away });
      }
      const nextGame = scoreTournaments({ ...input, now: startsAt - HOUR, currentStageId: stageId }).next!;
      for (const side of nextGame.sides) {
        const m = side.membershipId;
        if (side.active.length === 0) continue;
        const value = (a: string) => perceived[m][a] * (managerIds.indexOf(m) === cfg.repeater ? 1 : side.rest[a]);
        const byValue = [...side.active].sort((a, b) => value(b) - value(a));
        const choice = n === cfg.gamesPerStage && managerIds.indexOf(m) === cfg.tanker ? byValue.at(-1)! : byValue[0];
        input.picks.push({ stageId, number: n, membershipId: m, athleteId: choice });
      }
      const sessionId = `${id}:s`;
      input.games.push({ id, stageId, number: n, sessionId, startedAt: iso(startsAt), finishedAt: iso(startsAt + HOUR) });
      input.sessions.push({ id: sessionId, verifiedAt: iso(startsAt + HOUR) });
      for (const a of athleteIds) input.statLines.push(statLine(sessionId, a, skill[a], stats));
    }
    input.now = day1 + 5 * DAY; // every game verified and locked
    placesByStage.push(places(scoreTournaments(input)));
  }

  return { settings: s, managerIds, readNoise, placesByStage, input, result: scoreTournaments(input) };
}

/** One athlete's line for one game: better players (k) score more and turn it over less. */
function statLine(sessionId: string, athleteId: string, k: number, rand: () => number): YearStatLine {
  return {
    sessionId,
    athleteId,
    pointsPlayed: 5 + Math.floor(rand() * 15),
    stats: {
      goal: Math.floor(rand() * 3 * k),
      assist: Math.floor(rand() * 3 * k),
      block: Math.floor(rand() * 2 * k),
      callahan: rand() < 0.02 * k ? 1 : 0,
      turnover: Math.floor(rand() * 3 * (1.5 - k / 1.5)),
    },
  };
}
