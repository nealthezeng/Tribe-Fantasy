import { describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { loadTournamentStats, pickStatsStage, sortRows, totals } from './statsTable';

const mockRpc = vi.fn();
const tables: Record<string, unknown[]> = {
  stages: [{ id: 'S1', name: 'S1', starts_on: '2026-10-17', ends_on: '2026-10-18', auction_run_at: 'x' }],
  games: [
    { id: 'g1', stage_id: 'S1', number: 1, session_id: 'p1', started_at: 'a', finished_at: 'b', opponent: null },
    { id: 'g2', stage_id: 'S1', number: 2, session_id: 'p2', started_at: 'c', finished_at: null, opponent: null },
    { id: 'g3', stage_id: 'S1', number: 3, session_id: null, started_at: null, finished_at: null, opponent: null },
  ],
  athletes: [{ id: 'a', name: 'Ari' }],
  sessions: [{ id: 'p1', verified_at: 'v' }, { id: 'p2', verified_at: null }],
  stat_lines: [{ session_id: 'p1', athlete_id: 'a', stats: { goal: 2 } }],
};
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => {
      const b = { select: () => b, eq: () => b, in: () => b, not: () => b, order: () => b, range: () => b,
        then: (resolve: (v: unknown) => void) => resolve({ data: tables[table] ?? [], error: null }) };
      return b;
    },
  },
}));

const w = { goal: 3, assist: 3, block: 5, callahan: 12, turnover: -1 };
const names = new Map([['a', 'Ari'], ['b', 'Bo'], ['c', 'Cam']]);

describe('statsTable', () => {
  it('sums each player across games and scores base points', () => {
    const rows = totals([
      { athlete_id: 'a', stats: { goal: 2, callahan: 1 } },
      { athlete_id: 'a', stats: { goal: 1, turnover: 1 } },
      { athlete_id: 'x', stats: { block: 1 } },
    ], names, w);
    expect(rows.find((r) => r.key === 'a')).toEqual({ key: 'a', label: 'Ari', counts: { goal: 3, callahan: 1, turnover: 1 }, points: 20 });
    expect(rows.find((r) => r.key === 'x')?.label).toBe('Unknown');
  });

  it('sorts high first with ties A→Z, negatives last; names A→Z', () => {
    const rows = [{ key: 'c', label: 'Cam', counts: {}, points: 6 }, { key: 'b', label: 'Bo', counts: {}, points: -1 },
      { key: 'a', label: 'Ari', counts: {}, points: 6 }];
    expect(sortRows(rows, 'points', true).map((r) => r.label)).toEqual(['Ari', 'Cam', 'Bo']);
    expect(sortRows(rows, 'points', false).map((r) => r.label)).toEqual(['Bo', 'Ari', 'Cam']);
    expect(sortRows(rows, 'goal', true).map((r) => r.label)).toEqual(['Ari', 'Bo', 'Cam']); // missing stat = 0
    expect(sortRows(rows, 'label', false).map((r) => r.label)).toEqual(['Ari', 'Bo', 'Cam']);
  });

  it('picks the wanted tournament, else the one being played', () => {
    const st = (id: string, starts_on: string, ends_on: string, run = true) => ({ id, name: id, starts_on, ends_on, auction_run_at: run ? 'x' : null });
    const stages = [st('S2', '2026-11-07', '2026-11-08'), st('S1', '2026-10-17', '2026-10-18')];
    expect(pickStatsStage(stages, 'S1', '2026-11-01')?.id).toBe('S1');
    expect(pickStatsStage(stages, 'gone', '2026-11-01')?.id).toBe('S2'); // stale ?t= falls back
    expect(pickStatsStage(stages, null, '2026-10-17')?.id).toBe('S1'); // being played
    expect(pickStatsStage([], null, '2026-10-17')).toBeNull();
  });

  it('adds live lines of started unverified games when asked', async () => {
    // Two keepers tapped the same goal 2 s apart: it merges to one.
    const tap = (id: string, at: string, keeper: number) => ({ id, athlete_id: 'a', stat: 'goal', tapped_at: at, undoes: null, keeper });
    mockRpc.mockReset().mockResolvedValue({ error: null, data: [
      tap('t1', '2026-10-17T14:00:00+00:00', 1), tap('t2', '2026-10-17T14:00:02+00:00', 2)] });
    const live = await loadTournamentStats('se', null, { today: '2026-10-17', live: parseSettings({}) });
    expect(live.liveLines).toEqual([{ session_id: 'p2', athlete_id: 'a', stats: { goal: 1 } }]);
    expect(live.liveGames).toEqual([2]);
    expect(live.lines).toHaveLength(1);
    expect(mockRpc.mock.calls).toEqual([['live_game_taps', { p_game: 'g2' }]]);
    mockRpc.mockClear();
    const plain = await loadTournamentStats('se', null, { today: '2026-10-17' });
    expect([plain.liveLines, plain.liveGames]).toEqual([[], []]);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
