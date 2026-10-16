import { applyDelta, matchupDeltas, rankSnapshot, type StandingRow } from './points';
import { athleteWeekScore, type StatLine } from './scoring';
import type { SeasonSettings } from './settings';

export interface WeekMatchup {
  id: string;
  home: string;
  away: string | null;
}

export interface WeekInput {
  settings: SeasonSettings;
  matchups: WeekMatchup[];
  /** Starters per manager; [] = forfeit. */
  picks: Record<string, string[]>;
  statLines: StatLine[];
  /** Factor per started (manager, athlete), keyed by `pairKey`: share × tiredness × degradation. */
  multipliers: Record<string, number>;
  standings: StandingRow[];
}

export interface SideResult {
  managerId: string;
  athleteIds: string[];
  /** Keyed by athlete id. */
  athleteScores: Record<string, number>;
  multipliers: Record<string, number>;
  /** Σ athleteScore × multiplier. */
  score: number;
  delta: number;
}

export interface MatchupResult {
  id: string;
  home: SideResult;
  away: SideResult | null;
}

export interface WeekResult {
  ranks: Record<string, number>;
  athleteScores: Record<string, number>;
  matchups: MatchupResult[];
  standings: StandingRow[];
}

export const pairKey = (managerId: string, athleteId: string) => `${managerId}:${athleteId}`;

export function scoreWeek(input: WeekInput): WeekResult {
  const s = input.settings;
  const linesByAthlete = new Map<string, StatLine[]>();
  for (const l of input.statLines) {
    const list = linesByAthlete.get(l.athleteId) ?? [];
    list.push(l);
    linesByAthlete.set(l.athleteId, list);
  }
  const athleteScores: Record<string, number> = {};
  const scoreOf = (id: string) => (athleteScores[id] ??= athleteWeekScore(linesByAthlete.get(id) ?? [], s));
  for (const id of linesByAthlete.keys()) scoreOf(id);

  const side = (managerId: string): SideResult => {
    const athleteIds = input.picks[managerId] ?? [];
    const r: SideResult = { managerId, athleteIds, athleteScores: {}, multipliers: {}, score: 0, delta: 0 };
    for (const a of athleteIds) {
      const multiplier = input.multipliers[pairKey(managerId, a)];
      // Gate from the M1+M2 reviews: a missing entry is a caller bug, never a silent 1.
      if (multiplier === undefined) throw new Error(`No multiplier for ${pairKey(managerId, a)}`);
      r.athleteScores[a] = scoreOf(a);
      r.multipliers[a] = multiplier;
      r.score += r.athleteScores[a] * multiplier;
    }
    return r;
  };

  const ranks = rankSnapshot(input.standings);
  const matchups: MatchupResult[] = input.matchups.map((m) => {
    const home = side(m.home);
    if (m.away === null) return { id: m.id, home, away: null };
    const away = side(m.away);
    const d = matchupDeltas(home, away, ranks, input.standings.length, s);
    home.delta = d[home.managerId];
    away.delta = d[away.managerId];
    return { id: m.id, home, away };
  });

  const bySide = new Map<string, SideResult>();
  for (const m of matchups) {
    bySide.set(m.home.managerId, m.home);
    if (m.away) bySide.set(m.away.managerId, m.away);
  }
  const standings = input.standings.map((row) => {
    const sr = bySide.get(row.managerId);
    return sr
      ? { managerId: row.managerId, points: applyDelta(row.points, sr.delta, s), totalScore: row.totalScore + sr.score }
      : { ...row };
  });

  return { ranks, athleteScores, matchups, standings };
}
