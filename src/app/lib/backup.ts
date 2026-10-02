import type { LeagueYear } from './weekly';
import { fetchAll } from './weekly';
import { supabase } from './supabase';

/** Every public table and a unique order, so paged reads never skip or repeat a row. */
export const BACKUP_TABLES: Record<string, string[]> = {
  profiles: ['id'], user_roles: ['user_id', 'role'], seasons: ['id'], leagues: ['id'], invites: ['code'],
  memberships: ['id'], athletes: ['id'], audit_log: ['id'], sessions: ['id'], stat_taps: ['id'],
  stat_lines: ['session_id', 'athlete_id'], attendance: ['session_id', 'athlete_id'], injuries: ['id'],
  stages: ['id'], credit_ledger: ['id'], bids: ['id'], roster_slots: ['id'], weeks: ['id'],
  picks: ['week_id', 'membership_id'], games: ['id'], game_pairings: ['game_id', 'home'],
  game_picks: ['stage_id', 'game_number', 'membership_id'], bench_swaps: ['id'],
};

export interface Backup { exportedAt: string; tables: Record<string, unknown[]> }

/** Every row the admin can read. Sealed bids of an open auction are hidden even from admins, so they're absent. */
export async function loadBackup(now = new Date()): Promise<Backup> {
  const sb = supabase!;
  const entries = await Promise.all(Object.entries(BACKUP_TABLES).map(async ([table, keys]) => {
    const rows = await fetchAll<unknown>((from, to) => {
      let q = sb.from(table).select('*');
      for (const k of keys) q = q.order(k);
      return q.range(from, to);
    });
    return [table, rows] as const;
  }));
  return { exportedAt: now.toISOString(), tables: Object.fromEntries(entries) };
}

export interface LedgerLeague {
  name: string;
  memberships: {
    team_name: string;
    credit_ledger: { created_at: string; kind: string; amount: number; dollars: number | string | null; note: string | null;
      stages: { name: string } | null }[];
  }[];
}

/** One row per ledger entry, oldest first, for the treasurer. */
export function ledgerRows(leagues: LedgerLeague[]): (string | number)[][] {
  const rows = leagues.flatMap((l) => l.memberships.flatMap((m) => m.credit_ledger.map((e) => [
    e.created_at, l.name, m.team_name, e.kind, e.amount, e.dollars === null ? '' : Number(e.dollars).toFixed(2),
    e.stages?.name ?? '', e.note ?? '',
  ])));
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return [['date', 'league', 'team', 'kind', 'credits', 'dollars', 'stage', 'note'], ...rows];
}

/** The League tab's standings, one row per team, best first. */
export function standingsRows(leagues: { name: string; year: LeagueYear }[]): (string | number)[][] {
  const rows = leagues.flatMap(({ name, year }) => [...year.result.standings]
    .sort((a, b) => a.place - b.place)
    .map((s) => [name, `${s.tied ? 'T' : ''}${s.place}`, year.team.get(s.membershipId) ?? s.membershipId,
      +s.points.toFixed(2), s.wins, s.losses, s.ties, +s.totalScore.toFixed(2)]));
  return [['league', 'place', 'team', 'points', 'wins', 'losses', 'ties', 'total score'], ...rows];
}
