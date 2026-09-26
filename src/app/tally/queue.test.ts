// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Tap } from '../../core/taps';
import {
  canForgetLocally, isRejection, lastUndoable, loadQueue, queuedSessions, removeSent, storeQueue, unsavedTaps,
  type QueuedTap,
} from './queue';

const q = (id: string, undoes: string | null = null): QueuedTap => ({
  id, athlete_id: 'sam', stat: 'goal', tapped_at: '2026-11-16T18:00:00.000Z', undoes,
});
const tap = (id: string, keeperId: string, tappedAt: number, undoes: string | null = null): Tap => ({
  id, athleteId: 'sam', stat: 'goal', keeperId, tappedAt, undoes,
});

beforeEach(() => localStorage.clear());

describe('tap queue storage', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const S2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  it('survives a page reload (offline all practice)', () => {
    expect(storeQueue(A, S1, [q('a'), q('b')])).toBe(true);
    expect(loadQueue(A, S1).map((t) => t.id)).toEqual(['a', 'b']);
    expect(loadQueue(A, S2)).toEqual([]);
  });

  it('keeps keepers apart on a shared phone', () => {
    storeQueue(A, S1, [q('a')]);
    expect(loadQueue(B, S1)).toEqual([]);
    storeQueue(B, S1, [q('b')]);
    expect(loadQueue(A, S1).map((t) => t.id)).toEqual(['a']);
  });

  it('clears the key when the queue empties, and shrugs off corrupt storage', () => {
    storeQueue(A, S1, [q('a')]);
    storeQueue(A, S1, []);
    expect(localStorage.getItem(`tribe.tally.${A}.${S1}`)).toBeNull();
    localStorage.setItem(`tribe.tally.${A}.${S1}`, '{not json');
    expect(loadQueue(A, S1)).toEqual([]);
  });

  it('lists the sessions this keeper still has taps queued for', () => {
    storeQueue(A, S1, [q('a'), q('b')]);
    storeQueue(A, S2, [q('c')]);
    storeQueue(B, S1, [q('d')]);
    localStorage.setItem(`tribe.tally.${A}.not-a-session`, JSON.stringify([q('e')]));
    localStorage.setItem('unrelated', 'x');
    expect(queuedSessions(A).sort((x, y) => x.sessionId.localeCompare(y.sessionId)))
      .toEqual([{ sessionId: S1, count: 2 }, { sessionId: S2, count: 1 }]);
    expect(queuedSessions(B)).toEqual([{ sessionId: S1, count: 1 }]);
  });

  it('removes only the taps that were sent', () => {
    expect(removeSent([q('a'), q('b'), q('c')], [q('a'), q('c')]).map((t) => t.id)).toEqual(['b']);
  });
});

describe('isRejection', () => {
  it('drops batches the server will always refuse, retries everything else', () => {
    expect(isRejection({ message: 'SESSION_VERIFIED' })).toBe(true);
    expect(isRejection({ message: 'UNKNOWN_STAT' })).toBe(true);
    expect(isRejection(new TypeError('Failed to fetch'))).toBe(false);
    expect(isRejection({ message: 'upstream timeout' })).toBe(false);
  });
});

describe('lastUndoable', () => {
  it('prefers the newest queued tap even when saved times look later (slow phone clock)', () => {
    const saved = [tap('s1', 'me', 9_000_000)];
    const queued = [tap('q1', 'me', 1_000), tap('q2', 'me', 2_000)];
    expect(lastUndoable(saved, queued, 'me')?.id).toBe('q2');
  });

  it('skips undone taps, undos and other keepers', () => {
    const saved = [tap('s1', 'me', 1), tap('s2', 'me', 2), tap('x', 'other', 3)];
    const queued = [tap('u', 'me', 4, 's2')];
    expect(lastUndoable(saved, queued, 'me')?.id).toBe('s1');
    expect(lastUndoable([], [], 'me')).toBeNull();
  });
});

describe('canForgetLocally', () => {
  it('returns true when queued and not in flight', () => {
    const queue = [q('a'), q('b')];
    const inFlight = new Set<string>();
    expect(canForgetLocally('a', queue, inFlight, new Set())).toBe(true);
  });

  it('returns false when queued but in flight', () => {
    const queue = [q('a'), q('b')];
    const inFlight = new Set(['a']);
    expect(canForgetLocally('a', queue, inFlight, new Set())).toBe(false);
  });

  it('returns false when not queued (already saved)', () => {
    const queue = [q('a'), q('b')];
    const inFlight = new Set<string>();
    expect(canForgetLocally('c', queue, inFlight, new Set())).toBe(false);
  });
});

describe('saved taps still in a reopened queue', () => {
  it('are not forgotten locally: undo must send a real undo', () => {
    expect(canForgetLocally('a', [q('a')], new Set(), new Set(['a']))).toBe(false);
  });

  it('are not counted twice', () => {
    expect(unsavedTaps([q('s')], [q('a'), q('b')], new Set(['a', 's'])).map((t) => t.id)).toEqual(['b']);
    expect(unsavedTaps([q('s')], [q('a')], new Set()).map((t) => t.id)).toEqual(['s', 'a']);
  });
});
