import { describe, expect, it } from 'vitest';
import { parseSettings } from './settings';
import { autoPick, defaultPick } from './picks';

const s = parseSettings({});

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

describe('autoPick (tournament mode §2)', () => {
  it('picks the most rested athlete first, even over a better average', () => {
    const history = { a1: [9, 9, 9], a2: [1], a3: [2] };
    expect(autoPick(['a1', 'a2', 'a3'], { a1: 0.5, a2: 1, a3: 1 }, history, s)).toBe('a3');
    expect(autoPick(['a1', 'a2'], { a1: 0.5, a2: 0.75 }, history, s)).toBe('a2');
  });
  it('breaks equal rest by recent average, then lowest id', () => {
    expect(autoPick(['a1', 'a2'], { a1: 1, a2: 1 }, { a1: [1], a2: [5] }, s)).toBe('a2');
    expect(autoPick(['a2', 'a1'], { a1: 1, a2: 1 }, {}, s)).toBe('a1');
  });
  it('forfeits when configured or when nothing is available', () => {
    expect(autoPick(['a1'], { a1: 1 }, {}, parseSettings({ default_pick: 'forfeit' }))).toBeNull();
    expect(autoPick([], {}, {}, s)).toBeNull();
  });
  it('throws on a candidate with no tiredness (a caller bug, never a silent 1)', () => {
    expect(() => autoPick(['a1', 'a2'], { a1: 1 }, {}, s)).toThrow(/a2/);
  });
});
