// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { Tap } from '../../core/taps';
import { canForgetLocally, isRejection, lastUndoable, loadQueue, removeSent, storeQueue, type QueuedTap } from './queue';

const q = (id: string, undoes: string | null = null): QueuedTap => ({
  id, athlete_id: 'sam', stat: 'goal', tapped_at: '2026-11-16T18:00:00.000Z', undoes,
});
const tap = (id: string, keeperId: string, tappedAt: number, undoes: string | null = null): Tap => ({
  id, athleteId: 'sam', stat: 'goal', keeperId, tappedAt, undoes,
});

beforeEach(() => localStorage.clear());

describe('tap queue storage', () => {
  it('survives a page reload (offline all practice)', () => {
    expect(storeQueue('s1', [q('a'), q('b')])).toBe(true);
    expect(loadQueue('s1').map((t) => t.id)).toEqual(['a', 'b']);
    expect(loadQueue('s2')).toEqual([]);
  });

  it('clears the key when the queue empties, and shrugs off corrupt storage', () => {
    storeQueue('s1', [q('a')]);
    storeQueue('s1', []);
    expect(localStorage.getItem('tribe.tally.s1')).toBeNull();
    localStorage.setItem('tribe.tally.s1', '{not json');
    expect(loadQueue('s1')).toEqual([]);
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
    expect(canForgetLocally('a', queue, inFlight)).toBe(true);
  });

  it('returns false when queued but in flight', () => {
    const queue = [q('a'), q('b')];
    const inFlight = new Set(['a']);
    expect(canForgetLocally('a', queue, inFlight)).toBe(false);
  });

  it('returns false when not queued (already saved)', () => {
    const queue = [q('a'), q('b')];
    const inFlight = new Set<string>();
    expect(canForgetLocally('c', queue, inFlight)).toBe(false);
  });
});
