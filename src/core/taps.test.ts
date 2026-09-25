import { describe, expect, it } from 'vitest';
import { mergeTaps, type Tap } from './taps';

let n = 0;
const t = (keeperId: string, sec: number, over: Partial<Tap> = {}): Tap => ({
  id: `t${String(++n).padStart(3, '0')}`,
  athleteId: 'sam',
  stat: 'goal',
  keeperId,
  tappedAt: 1_000_000 + sec * 1000,
  undoes: null,
  ...over,
});

describe('mergeTaps', () => {
  it("counts one keeper's taps one by one, even seconds apart", () => {
    expect(mergeTaps([t('A', 0), t('A', 1), t('A', 2)], 10).counts).toEqual({ sam: { goal: 3 } });
  });

  it('merges the same goal tapped by two keepers inside the window, and reports the group', () => {
    const a = t('A', 0);
    const b = t('B', 4);
    const r = mergeTaps([a, b], 10);
    expect(r.counts).toEqual({ sam: { goal: 1 } });
    expect(r.merged).toEqual([{ athleteId: 'sam', stat: 'goal', tapIds: [a.id, b.id].sort() }]);
  });

  it('merges at exactly the window and not one second past it', () => {
    expect(mergeTaps([t('A', 0), t('B', 10)], 10).counts.sam.goal).toBe(1);
    expect(mergeTaps([t('A', 0), t('B', 11)], 10).counts.sam.goal).toBe(2);
  });

  it('counts 2 when A taps two goals and B taps one of them', () => {
    expect(mergeTaps([t('A', 0), t('A', 30), t('B', 31)], 10).counts.sam.goal).toBe(2);
  });

  it('pairs each tap with its closest match', () => {
    // B at 8 is closer to A at 9 than to A at 0, so A@0 stays alone: 2 goals.
    const r = mergeTaps([t('A', 0), t('B', 8), t('A', 9)], 10);
    expect(r.counts.sam.goal).toBe(2);
    expect(r.merged[0].tapIds).toHaveLength(2);
  });

  it('counts one goal tapped by three keepers', () => {
    expect(mergeTaps([t('A', 0), t('B', 2), t('C', 5)], 10).counts.sam.goal).toBe(1);
  });

  it('never lets a group span more than the window', () => {
    // A@0–B@6 and B@6–C@12 are each within 10s, but A@0..C@12 spans 12s.
    expect(mergeTaps([t('A', 0), t('B', 6), t('C', 12)], 10).counts.sam.goal).toBe(2);
  });

  it('keeps athletes and stats apart', () => {
    const r = mergeTaps([t('A', 0), t('B', 1, { stat: 'assist' }), t('B', 1, { athleteId: 'ali' })], 10);
    expect(r.counts).toEqual({ sam: { goal: 1, assist: 1 }, ali: { goal: 1 } });
    expect(r.merged).toEqual([]);
  });

  it('drops an undone tap and its undo, before merging', () => {
    const wrong = t('A', 0);
    const r = mergeTaps([wrong, t('A', 1, { undoes: wrong.id }), t('B', 2)], 10);
    expect(r.counts).toEqual({ sam: { goal: 1 } });
    expect(r.merged).toEqual([]);
  });

  it('leaves out athletes whose taps were all undone', () => {
    const wrong = t('A', 0);
    expect(mergeTaps([wrong, t('A', 1, { undoes: wrong.id })], 10).counts).toEqual({});
  });

  it('does not merge anything when the window is 0', () => {
    expect(mergeTaps([t('A', 0), t('B', 0)], 0).counts.sam.goal).toBe(2);
  });

  it('gives the same result whatever order the taps arrive in', () => {
    const taps = [t('A', 0), t('B', 3), t('A', 20), t('C', 21), t('B', 40)];
    const forward = mergeTaps(taps, 10);
    expect(mergeTaps([...taps].reverse(), 10)).toEqual(forward);
    expect(forward.counts.sam.goal).toBe(3);
  });
});
