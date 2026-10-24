import { describe, expect, it } from 'vitest';
import { addable, bump, drop, joinCall, listStats, toQueued, waitingCount } from './waiting';

const T1 = '2026-11-07T15:00:00.000Z';
const T2 = '2026-11-07T15:00:20.000Z';
const NAMES: Record<string, string> = { toby: 'Toby Grant', maxO: 'Max Ortiz', bo: 'Bo Stone' };
const nameOf = (id: string) => NAMES[id];

describe('the waiting set (M16 §5.4)', () => {
  it('joins calls in the order players were first named, each stat at its own call time', () => {
    const one = joinCall(null, [{ athleteId: 'maxO', stat: 'goal' }, { athleteId: 'toby', stat: 'assist' }], 'Toby to Ortiz', T1);
    const two = joinCall(one, [{ athleteId: 'bo', stat: 'block' }, { athleteId: 'maxO', stat: 'goal' }], 'Bo D, Ortiz scores', T2);
    expect(two.heard).toBe('Bo D, Ortiz scores');
    expect(two.players).toEqual([{ athleteId: 'maxO', at: T1 }, { athleteId: 'toby', at: T1 }, { athleteId: 'bo', at: T2 }]);
    expect(two.stats).toEqual([
      { athleteId: 'maxO', stat: 'goal', at: T1 }, { athleteId: 'toby', stat: 'assist', at: T1 },
      { athleteId: 'bo', stat: 'block', at: T2 }, { athleteId: 'maxO', stat: 'goal', at: T2 },
    ]);
    expect(waitingCount(two, 'maxO', 'goal')).toBe(2);
    expect(one.stats).toHaveLength(2); // joinCall never changes the set it is given
  });

  it('a fix tapped on a card gets the time of the call that put the player in the group', () => {
    const one = joinCall(null, [{ athleteId: 'maxO', stat: 'goal' }], 'Ortiz scores', T1);
    const two = joinCall(one, [{ athleteId: 'maxO', stat: 'block' }], 'Ortiz D', T2);
    expect(bump(two, 'maxO', 'assist').stats.at(-1)).toEqual({ athleteId: 'maxO', stat: 'assist', at: T1 });
  });

  it('takes the newest waiting stat off, keeps the player at zero, and says null when none waits', () => {
    const set = joinCall(joinCall(null, [{ athleteId: 'bo', stat: 'block' }], 'Bo D', T1), [{ athleteId: 'bo', stat: 'block' }], 'Bo D', T2);
    const once = drop(set, 'bo', 'block');
    expect(once?.stats).toEqual([{ athleteId: 'bo', stat: 'block', at: T1 }]);
    const zero = drop(once!, 'bo', 'block');
    expect(zero).not.toBeNull();
    expect(zero!.players).toEqual([{ athleteId: 'bo', at: T1 }]);
    expect(waitingCount(zero!, 'bo', 'block')).toBe(0);
    expect(drop(zero!, 'bo', 'block')).toBeNull();
  });

  it('leaves a blocked player out of what Add sends, as fresh queued taps at the call time', () => {
    const set = joinCall(null, [{ athleteId: 'toby', stat: 'assist' }, { athleteId: 'maxO', stat: 'goal' }], 'Toby to Ortiz', T1);
    const ok = addable(set, (id) => id !== 'maxO');
    expect(ok).toEqual([{ athleteId: 'toby', stat: 'assist', at: T1 }]);
    const queued = toQueued([...ok, ...ok]);
    expect(queued.map(({ athlete_id, stat, tapped_at, undoes }) => ({ athlete_id, stat, tapped_at, undoes })))
      .toEqual([1, 2].map(() => ({ athlete_id: 'toby', stat: 'assist', tapped_at: T1, undoes: null })));
    expect(queued[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(queued[0].id).not.toBe(queued[1].id);
  });

  it('names the waiting stats in player order, then the board stat order, with a count past one', () => {
    const set = joinCall(null, [
      { athleteId: 'toby', stat: 'turnover' }, { athleteId: 'maxO', stat: 'goal' }, { athleteId: 'toby', stat: 'assist' },
      { athleteId: 'maxO', stat: 'goal' }, { athleteId: 'maxO', stat: 'block' },
    ], 'call', T1);
    expect(listStats(set.stats, nameOf)).toBe('Toby Grant Assist, Toby Grant Turnover, Max Ortiz Goal ×2, Max Ortiz D');
    expect(listStats(set.stats.slice(1, 4), nameOf)).toBe('Max Ortiz Goal ×2, Toby Grant Assist');
  });
});
