// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changes, readSeen, seenKey, writeSeen, type Seen } from './seen';

const seen = (mine: number, points: Record<string, number>, them = 0): Seen => ({ mine, them, points: { mine: points, them: {} } });

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('seen', () => {
  it('finds per-starter changes of at least 0.01', () => {
    expect(changes(seen(3, { a1: 3 }), seen(8, { a1: 6, a2: 2 }))).toEqual({ mine: { a1: 3 }, them: {} }); // a2 is new: no chip
    expect(changes(seen(3, { a1: 3 }), seen(3.004, { a1: 3.004 }))).toBeNull();
    expect(changes(null, seen(3, { a1: 3 }))).toBeNull();
  });

  it('treats a score-only change as a change', () => {
    expect(changes(seen(3, { a1: 3 }), seen(6, { a1: 3 }))).toEqual({ mine: {}, them: {} });
  });

  it('round-trips through storage under a per-team, per-game key', () => {
    const key = seenKey('m1', 'g1');
    expect(key).toBe('tribe.seen.m1.g1');
    writeSeen(key, seen(3, { a1: 3 }));
    expect(readSeen(key)).toEqual(seen(3, { a1: 3 }));
  });

  it('reads nothing from blocked or corrupt storage', () => {
    localStorage.setItem('k', '{"x":1}');
    expect(readSeen('k')).toBeNull();
    localStorage.setItem('k', 'not json');
    expect(readSeen('k')).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readSeen('k')).toBeNull();
  });

  it('ignores write failures', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => writeSeen('k', seen(1, {}))).not.toThrow();
  });
});
