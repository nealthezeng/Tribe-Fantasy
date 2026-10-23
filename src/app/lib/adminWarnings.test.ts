import { describe, expect, it, vi } from 'vitest';
import { lateJoiners, loadLateJoiners, stuckGames } from './adminWarnings';
import type { GameRow } from './tournament';

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ stages: [] as Row[], leagues: [] as Row[], credit_ledger: [] as Row[] }));

vi.mock('./supabase', () => ({
  supabase: {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const builder = {
        select: () => builder,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return builder; },
        order: () => builder,
        then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({
          data: ((db as Record<string, Row[]>)[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === undefined || r[c] === v)),
          error: null,
        }),
      };
      return builder;
    },
  },
}));

const TODAY = '2026-10-23';
const STAGES = [
  { id: 'fe', name: 'Feasterns', ends_on: '2026-10-09' },
  { id: 'cc', name: 'CCCs', ends_on: TODAY }, // its last day is today: not over yet
];
const game = (id: string, stage_id: string, number: number, o: Partial<GameRow> = {}): GameRow => ({
  id, stage_id, number, session_id: `s-${id}`, started_at: '2026-10-08T14:00:00Z', finished_at: '2026-10-08T15:30:00Z', opponent: null, ...o,
});

describe('stuckGames (P9 ruling 18)', () => {
  it('flags a game still live after its tournament ended', () => {
    const games = [game('g4', 'fe', 4, { finished_at: null })];
    expect(stuckGames(STAGES, games, [{ id: 's-g4', verified_at: null }], TODAY))
      .toEqual([{ stage: 'Feasterns', number: 4, sessionId: 's-g4', live: true }]);
  });

  it('flags a finished game nobody verified, and skips a verified one', () => {
    const games = [game('g3', 'fe', 3), game('g2', 'fe', 2)];
    const sessions = [{ id: 's-g3', verified_at: null }, { id: 's-g2', verified_at: '2026-10-09T10:00:00Z' }];
    expect(stuckGames(STAGES, games, sessions, TODAY)).toEqual([{ stage: 'Feasterns', number: 3, sessionId: 's-g3', live: false }]);
  });

  it("leaves the current tournament's unverified games alone", () => {
    const games = [game('c1', 'cc', 1, { finished_at: null }), game('c2', 'cc', 2)];
    expect(stuckGames(STAGES, games, [{ id: 's-c1', verified_at: null }, { id: 's-c2', verified_at: null }], TODAY)).toEqual([]);
  });

  it('skips a void game (its session deleted) and one that never started', () => {
    const games = [
      game('g1', 'fe', 1, { session_id: null }),
      game('g2', 'fe', 2), // session row gone
      game('g5', 'fe', 5, { session_id: null, started_at: null, finished_at: null }),
    ];
    expect(stuckGames(STAGES, games, [], TODAY)).toEqual([]);
  });
});

describe('lateJoiners (P9 ruling 12)', () => {
  const members = [
    { id: 'm1', team_name: 'Huck Finn', league: 'League A' },
    { id: 'm2', team_name: 'Layout Legends', league: 'League A' },
    { id: 'm3', team_name: 'Money 🤑', league: 'League B' },
  ];

  it('is empty until someone has the allowance', () => {
    expect(lateJoiners(members, [], 'cc')).toEqual([]);
    expect(lateJoiners(members, [{ membership_id: 'm1', stage_id: 'fe' }], 'cc')).toEqual([]);
  });

  it("lists the teams without that tournament's allowance once others have it", () => {
    const rows = [{ membership_id: 'm1', stage_id: 'cc' }, { membership_id: 'm3', stage_id: 'cc' }, { membership_id: 'm2', stage_id: 'fe' }];
    expect(lateJoiners(members, rows, 'cc')).toEqual([{ id: 'm2', team: 'Layout Legends', league: 'League A' }]);
  });
});

describe('loadLateJoiners', () => {
  const stage = (id: string, starts_on: string, auction_run_at: string | null) =>
    ({ id, name: id === 'cc' ? 'CCCs' : 'Feasterns', season_id: 'se1', starts_on, ends_on: starts_on, bid_close_at: null, auction_seed: null, auction_run_at });

  it("uses the newest tournament whose shares aren't settled, and skips removed teams", async () => {
    db.stages = [stage('fe', '2026-10-08', '2026-10-07T00:00:00Z'), stage('cc', '2026-11-07', null)];
    db.leagues = [{ name: 'League A', season_id: 'se1', memberships: [
      { id: 'm1', team_name: 'Huck Finn', removed_at: null },
      { id: 'm2', team_name: 'Layout Legends', removed_at: null },
      { id: 'm4', team_name: 'Gone Team', removed_at: '2026-10-20T00:00:00Z' },
    ] }];
    db.credit_ledger = [
      { membership_id: 'm1', stage_id: 'cc', kind: 'allowance' },
      { membership_id: 'm2', stage_id: 'fe', kind: 'allowance' },
      { membership_id: 'm2', stage_id: 'cc', kind: 'adjustment' },
    ];
    expect(await loadLateJoiners('se1')).toEqual({
      stage: { id: 'cc', name: 'CCCs' }, teams: [{ id: 'm2', team: 'Layout Legends', league: 'League A' }],
    });
  });

  it('is null once every tournament is settled', async () => {
    db.stages = [stage('fe', '2026-10-08', '2026-10-07T00:00:00Z')];
    expect(await loadLateJoiners('se1')).toBeNull();
  });
});
