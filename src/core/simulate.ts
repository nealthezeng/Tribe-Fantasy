import { allocate, fillLeftovers, type Bid, type ManagerBudget } from './allocation';
import { availableAthletes, usedThisCycle, type PickRecord } from './picks';
import { stageAllowance } from './points';
import { hashSeed, mulberry32 } from './rng';
import { parseSettings, type SeasonSettings } from './settings';
import { scoreYear, type YearInput, type YearResult, type YearSession, type YearStatLine, type YearWeek } from './year';

export interface YearSimConfig {
  managers: number;
  athletes: number;
  stages: number;
  weeksPerStage: number;
  seed: string;
  settings?: unknown;
  /** This manager (index) throws the last week of every stage by starting their worst athlete. */
  tanker?: number;
}

export interface YearSimResult {
  settings: SeasonSettings;
  managerIds: string[];
  /** How far off each manager's read of athlete skill is (lower = sharper). */
  readNoise: Record<string, number>;
  /** Each manager's place (1 = best) at the end of each stage; the last entry is the final standings. */
  placesByStage: Record<string, number>[];
  input: YearInput;
  result: YearResult;
}

const DAY = 86_400_000;
const pad = (i: number) => String(i).padStart(2, '0');
const iso = (t: number) => new Date(t).toISOString();
const day = (t: number) => iso(t).slice(0, 10);
const places = (r: YearResult) => Object.fromEntries(r.standings.map((x) => [x.membershipId, x.place]));

/**
 * A whole league year played by fake managers under the real rules, scored by the real scoreYear. Each stage:
 * allowance from the standings so far → one sealed auction (allocate + fill) → weekly picks → stats. Credits
 * carry over. Weeks run Mon–Sun from 2027-01-04; practices Tue and Thu, and a tournament ends each stage.
 * ponytail: no injuries, late joiners or missed picks; the DB dry run (tests/db/dry-run.test.ts) covers those.
 */
export function simulateYear(cfg: YearSimConfig): YearSimResult {
  const s = parseSettings(cfg.settings ?? {});
  const stream = (name: string) => mulberry32(hashSeed(`${cfg.seed}:${name}`));
  const setup = stream('setup');
  const managerIds = Array.from({ length: cfg.managers }, (_, i) => `m${pad(i)}`);
  const athleteIds = Array.from({ length: cfg.athletes }, (_, i) => `a${pad(i)}`);
  const skill = Object.fromEntries(athleteIds.map((a) => [a, 0.5 + setup()]));
  const readNoise = Object.fromEntries(managerIds.map((m) => [m, 0.05 + 0.6 * setup()]));
  const start = Date.parse('2027-01-04T00:00:00Z'); // a Monday

  const input: YearInput = {
    settings: s, now: 0, weeks: [], slots: [], picks: [], sessions: [], statLines: [], injuries: [],
    members: managerIds.map((id) => ({ id, createdAt: iso(start - DAY) })),
  };
  const balance = Object.fromEntries(managerIds.map((m) => [m, 0]));
  const placesByStage: Record<string, number>[] = [];
  let weekIndex = 0;

  for (let st = 0; st < cfg.stages; st++) {
    const stageId = `s${pad(st)}`;
    const stageStart = start + st * cfg.weeksPerStage * 7 * DAY;

    // Allowance from the standings so far (everyone ties before the first week), granted once the closing
    // tournament has locked, as the admin does.
    const sofar = scoreYear({ ...input, now: stageStart + 3 * DAY });
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
        placedAt: iso(stageStart - DAY + i * 1000 + Math.floor(read() * 999)),
      }));
    }
    const budgets: ManagerBudget[] = managerIds.map((m) => ({ managerId: m, budget: balance[m], openSlots: s.roster_size }));
    const run = allocate(bids, budgets, athleteIds);
    for (const aw of [...run.awards, ...fillLeftovers(run.remaining, run.unclaimed, `${cfg.seed}:${stageId}`)]) {
      balance[aw.managerId] -= aw.amount;
      input.slots.push({ stageId, membershipId: aw.managerId, athleteId: aw.athleteId });
    }
    const roster = (m: string) => input.slots.filter((x) => x.stageId === stageId && x.membershipId === m)
      .map((x) => x.athleteId).sort();

    // Weeks: picks by each manager's read (the tanker starts their worst in the stage's last week), then stats.
    const stageRecords: PickRecord[] = [];
    const stats = stream(`stats:${st}`);
    for (let wk = 0; wk < cfg.weeksPerStage; wk++, weekIndex++) {
      const monday = stageStart + wk * 7 * DAY;
      const week: YearWeek = {
        id: `w${pad(weekIndex)}`, stageId, startsOn: day(monday), endsOn: day(monday + 6 * DAY),
        startsAt: iso(monday), endsAt: iso(monday + 7 * DAY), pickLockAt: iso(monday + 21 * 3_600_000),
      };
      input.weeks.push(week);
      const last = wk === cfg.weeksPerStage - 1;
      for (const m of managerIds) {
        const r = roster(m);
        const avail = availableAthletes(r, usedThisCycle(m, r, stageRecords, weekIndex));
        if (avail.length === 0) continue;
        const byRead = [...avail].sort((a, b) => perceived[m][b] - perceived[m][a]);
        const choice = last && managerIds.indexOf(m) === cfg.tanker ? byRead.at(-1)! : byRead[0];
        stageRecords.push({ week: weekIndex, managerId: m, athleteId: choice });
        input.picks.push({ weekId: week.id, membershipId: m, athleteId: choice });
      }
      const days: [number, YearSession['kind']][] = [[1, 'practice'], [3, 'practice']];
      if (last) days.push([5, 'tournament']);
      for (const [offset, kind] of days) {
        const session: YearSession = { id: `${week.id}:${offset}`, kind, heldOn: day(monday + offset * DAY), counts: true,
          verifiedAt: iso(monday + offset * DAY + 3_600_000) };
        input.sessions.push(session);
        for (const a of athleteIds) input.statLines.push(statLine(session.id, a, skill[a], stats));
      }
    }
    input.now = stageStart + cfg.weeksPerStage * 7 * DAY + 3 * DAY; // every session verified and locked
    placesByStage.push(places(scoreYear(input)));
  }

  return { settings: s, managerIds, readNoise, placesByStage, input, result: scoreYear(input) };
}

/** One athlete's line for one session: better players (k) score more and turn it over less. */
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
