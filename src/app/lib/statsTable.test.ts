import { describe, expect, it } from 'vitest';
import { pickStatsStage, sortRows, totals } from './statsTable';

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
});
