import { allocate, fillLeftovers, type Bid, type ManagerBudget } from './allocation';
import { stageMultiplier } from './decay';
import { availableAthletes, defaultPick, usedThisCycle, type PickRecord } from './picks';
import type { StandingRow } from './points';
import { hashSeed, mulberry32 } from './rng';
import { roundRobin } from './schedule';
import type { StatLine } from './scoring';
import { parseSettings, type SeasonSettings } from './settings';
import { pairKey, scoreWeek, type WeekResult } from './week';

export interface SimConfig {
  managers: number;
  athletes: number;
  weeks: number;
  seed: string;
  settings?: unknown;
  tournamentWeeks?: number[];
}

export interface SimResult {
  settings: SeasonSettings;
  rosters: Record<string, string[]>;
  picks: PickRecord[];
  weeks: WeekResult[];
  standings: StandingRow[];
}

const pad = (i: number) => String(i).padStart(2, '0');

/** Plays a fake season with the real rules. Used for tests and for tuning settings. */
export function simulateSeason(cfg: SimConfig): SimResult {
  const s = parseSettings(cfg.settings ?? {});
  const rand = mulberry32(hashSeed(cfg.seed));
  const managerIds = Array.from({ length: cfg.managers }, (_, i) => `m${pad(i)}`);
  const athleteIds = Array.from({ length: cfg.athletes }, (_, i) => `a${pad(i)}`);
  const skill = Object.fromEntries(athleteIds.map((a) => [a, 0.5 + rand()]));

  const budgets: ManagerBudget[] = managerIds.map((managerId) => ({
    managerId,
    budget: s.allowance_base + Math.floor(rand() * 200),
    openSlots: s.roster_size,
  }));
  const bids: Bid[] = [];
  for (const m of budgets) {
    for (const a of athleteIds) {
      if (rand() < 0.3) {
        bids.push({
          id: `${m.managerId}-${a}`,
          managerId: m.managerId,
          athleteId: a,
          amount: 1 + Math.floor(rand() * (m.budget / s.roster_size) * 1.5),
          placedAt: new Date(Date.UTC(2027, 0, 25, 0, 0, Math.floor(rand() * 3600))).toISOString(),
        });
      }
    }
  }
  const round1 = allocate(bids, budgets, athleteIds);
  const filled = fillLeftovers(round1.remaining, round1.unclaimed, cfg.seed);
  const rosters: Record<string, string[]> = Object.fromEntries(managerIds.map((m) => [m, [] as string[]]));
  // ponytail: one stage, so every pair is a first start (multiplier 1). Multi-stage years come with M8 tuning.
  const multipliers: Record<string, number> = {};
  for (const aw of [...round1.awards, ...filled]) {
    rosters[aw.managerId].push(aw.athleteId);
    multipliers[pairKey(aw.managerId, aw.athleteId)] = stageMultiplier(0, s);
  }
  for (const m of managerIds) rosters[m].sort();

  const schedule = roundRobin(managerIds, cfg.weeks);
  let standings: StandingRow[] = managerIds.map((managerId) => ({ managerId, points: 0, totalScore: 0 }));
  const picks: PickRecord[] = [];
  const history: Record<string, number[]> = {};
  const weeks: WeekResult[] = [];

  for (let week = 1; week <= cfg.weeks; week++) {
    const sessionType = cfg.tournamentWeeks?.includes(week) ? 'tournament' : 'practice';
    const statLines: StatLine[] = athleteIds.map((a) => {
      const k = skill[a];
      return {
        athleteId: a,
        sessionType,
        pointsPlayed: 5 + Math.floor(rand() * 15),
        stats: {
          goal: Math.floor(rand() * 3 * k),
          assist: Math.floor(rand() * 3 * k),
          block: Math.floor(rand() * 2 * k),
          callahan: rand() < 0.02 * k ? 1 : 0,
          turnover: Math.floor(rand() * 3 * (1.5 - k / 1.5)),
        },
      };
    });

    const weekPicks: Record<string, string | null> = {};
    for (const m of managerIds) {
      const used = usedThisCycle(m, rosters[m], picks, week);
      const choice = defaultPick(availableAthletes(rosters[m], used), history, s);
      weekPicks[m] = choice;
      if (choice !== null) picks.push({ week, managerId: m, athleteId: choice });
    }

    const result = scoreWeek({
      settings: s,
      matchups: schedule[week - 1].map(([home, away], i) => ({ id: `w${week}-${i}`, home, away })),
      picks: weekPicks,
      statLines,
      multipliers,
      standings,
    });
    for (const [a, score] of Object.entries(result.athleteScores)) (history[a] ??= []).push(score);
    standings = result.standings;
    weeks.push(result);
  }

  return { settings: s, rosters, picks, weeks, standings };
}
