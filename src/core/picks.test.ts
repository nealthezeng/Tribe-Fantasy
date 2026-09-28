import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { defaultPick, usedThisCycle, validatePick, type PickRecord } from './picks';

const s = parseSettings({});
const p = (week: number, managerId: string, athleteId: string): PickRecord => ({ week, managerId, athleteId });

describe('usedThisCycle', () => {
  const roster = ['a1', 'a2', 'a3'];

  it('tracks athletes used so far this cycle, only counting weeks before the current one', () => {
    const picks = [p(1, 'm1', 'a1'), p(2, 'm1', 'a2'), p(3, 'm1', 'a3')];
    expect([...usedThisCycle('m1', roster, picks, 3)].sort()).toEqual(['a1', 'a2']);
  });

  it('resets once every rostered athlete has been used', () => {
    const picks = [p(1, 'm1', 'a1'), p(2, 'm1', 'a2'), p(3, 'm1', 'a3'), p(4, 'm1', 'a2')];
    expect([...usedThisCycle('m1', roster, picks, 4)]).toEqual([]);
    expect([...usedThisCycle('m1', roster, picks, 5)]).toEqual(['a2']);
  });

  it('ignores used athletes who are no longer on the roster', () => {
    const picks = [p(1, 'm1', 'gone')];
    expect([...usedThisCycle('m1', roster, picks, 2)]).toEqual([]);
  });

});

describe('validatePick', () => {
  it('rejects athletes not on the roster or already used', () => {
    const used = new Set(['a1']);
    expect(validatePick('zz', ['a1', 'a2'], used)).toBe('NOT_ON_ROSTER');
    expect(validatePick('a1', ['a1', 'a2'], used)).toBe('ATHLETE_ALREADY_USED');
    expect(validatePick('a2', ['a1', 'a2'], used)).toBeNull();
  });
});

describe('defaultPick', () => {
  it('picks the best 3-week average, ties to the lowest id', () => {
    const history = { a1: [1, 1, 1], a2: [0, 9, 3, 3], a3: [3, 3, 3] };
    expect(defaultPick(['a1', 'a2', 'a3'], history, s)).toBe('a2');
    expect(defaultPick(['a3', 'a1'], { a1: [3], a3: [3] }, s)).toBe('a1');
    expect(defaultPick(['a2', 'a1'], {}, s)).toBe('a1');
  });
  it('forfeits when configured or when nothing is available', () => {
    expect(defaultPick(['a1'], {}, parseSettings({ default_pick: 'forfeit' }))).toBeNull();
    expect(defaultPick([], {}, s)).toBeNull();
  });
});
