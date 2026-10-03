import { describe, expect, it } from 'vitest';
import { BACKUP_TABLES, ledgerRows, standingsRows } from './backup';
import type { LeagueTournament } from './tournament';

describe('backup', () => {
  it('lists every table the migrations create', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../../../supabase/migrations/', import.meta.url);
    const sql = readdirSync(dir).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
    const created = [...sql.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]).sort();
    expect(Object.keys(BACKUP_TABLES).sort()).toEqual(created);
  });

  it('writes the ledger oldest first with dollars to the cent', () => {
    const rows = ledgerRows([{ name: 'A', memberships: [{ team_name: 'Zeal', credit_ledger: [
      { created_at: '2026-10-19T00:00:00Z', kind: 'bid', amount: -40, dollars: null, note: null, stages: { name: 'Fall' } },
      { created_at: '2026-10-18T00:00:00Z', kind: 'donation', amount: 100, dollars: '5', note: 'cash', stages: null },
    ] }] }]);
    expect(rows).toEqual([
      ['date', 'league', 'team', 'kind', 'credits', 'dollars', 'stage', 'note'],
      ['2026-10-18T00:00:00Z', 'A', 'Zeal', 'donation', 100, '5.00', '', 'cash'],
      ['2026-10-19T00:00:00Z', 'A', 'Zeal', 'bid', -40, '', 'Fall', ''],
    ]);
  });

  it('writes standings best first with ties marked', () => {
    const row = (membershipId: string, place: number, tied: boolean, points: number) =>
      ({ membershipId, place, tied, points, rank: place, wins: 1, losses: 0, ties: 0, totalScore: 3.456 });
    const year = {
      result: { games: [], standings: [row('b', 2, true, 1), row('a', 1, false, 2.256), row('c', 2, true, 1)] },
      team: new Map([['a', 'Zeal'], ['b', 'Money'], ['c', 'Gimp']]),
    } as unknown as LeagueTournament;
    expect(standingsRows([{ name: 'A', year }]).map((r) => r.slice(0, 4))).toEqual([
      ['league', 'place', 'team', 'points'], ['A', '1', 'Zeal', 2.26], ['A', 'T2', 'Money', 1], ['A', 'T2', 'Gimp', 1],
    ]);
  });
});
