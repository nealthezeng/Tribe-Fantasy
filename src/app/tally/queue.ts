import type { Tap } from '../../core/taps';

/** A tap waiting on this phone, in the JSON shape `save_taps` takes. */
export interface QueuedTap {
  id: string;
  athlete_id: string;
  stat: string;
  tapped_at: string; // ISO, phone clock
  undoes: string | null;
}

/** A row of public.stat_taps as the client reads it. */
export interface StatTapRow {
  id: string;
  athlete_id: string;
  stat: string;
  keeper_id: string;
  tapped_at: string;
  undoes: string | null;
}

export const BATCH_MAX = 500; // save_taps rejects bigger batches

/** Errors the server will give again on retry: drop the batch and tell the keeper. Anything else is retried. */
const REJECTIONS = [
  'FORBIDDEN', 'NOT_FOUND', 'SESSION_VERIFIED', 'UNKNOWN_STAT', 'OWNS_ATHLETE', 'INVALID_TAPS', 'NOT_SIGNED_IN',
];

// Per keeper as well as per session, so on a shared phone one keeper never sends another's taps.
const storageKey = (userId: string, sessionId: string) => `tribe.tally.${userId}.${sessionId}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loadQueue(userId: string, sessionId: string): QueuedTap[] {
  try {
    const raw = localStorage.getItem(storageKey(userId, sessionId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as QueuedTap[]) : [];
  } catch {
    return [];
  }
}

/** False when the phone refused to store it (private mode, full storage): the taps then live only in memory. */
export function storeQueue(userId: string, sessionId: string, queue: QueuedTap[]): boolean {
  try {
    if (queue.length === 0) localStorage.removeItem(storageKey(userId, sessionId));
    else localStorage.setItem(storageKey(userId, sessionId), JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
}

/** Sessions this keeper still has taps queued for on this phone, including ones since verified. */
export function queuedSessions(userId: string): { sessionId: string; count: number }[] {
  const prefix = storageKey(userId, '');
  const out: { sessionId: string; count: number }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      const sessionId = key.slice(prefix.length);
      if (!key.startsWith(prefix) || !UUID.test(sessionId)) continue;
      const count = loadQueue(userId, sessionId).length;
      if (count > 0) out.push({ sessionId, count });
    }
  } catch {
    // Storage unreadable: nothing to list.
  }
  return out;
}

export function removeSent(queue: QueuedTap[], sent: QueuedTap[]): QueuedTap[] {
  const ids = new Set(sent.map((t) => t.id));
  return queue.filter((t) => !ids.has(t.id));
}

/** The server's error code, e.g. 'NOT_FOUND'. */
export const errorCode = (err: unknown): string =>
  (typeof err === 'object' && err !== null && 'message' in err ? String(err.message) : String(err)).trim();

export function isRejection(err: unknown): boolean {
  return REJECTIONS.includes(errorCode(err));
}

/**
 * A batch came back NOT_FOUND (t203): which taps to drop, and why. The game gone (admin Undo game / delete) drops
 * them all; otherwise only taps for players that no longer exist (admin force-delete), so the rest still save.
 * `message` null: no cause found, drop the batch with the server's message.
 */
export function notFoundDrop(batch: QueuedTap[], sessionExists: boolean, athleteIds: ReadonlySet<string>):
  { drop: QueuedTap[]; message: string | null } {
  if (!sessionExists) return { drop: batch, message: 'an admin undid or deleted this game.' };
  const drop = batch.filter((t) => !athleteIds.has(t.athlete_id));
  return drop.length > 0 ? { drop, message: 'the player was deleted by an admin.' } : { drop: batch, message: null };
}

export const rowToTap = (r: StatTapRow): Tap => ({
  id: r.id,
  athleteId: r.athlete_id,
  stat: r.stat,
  keeperId: r.keeper_id,
  tappedAt: Date.parse(r.tapped_at),
  undoes: r.undoes,
});

export const queuedToTap = (q: QueuedTap, keeperId: string): Tap => ({
  id: q.id,
  athleteId: q.athlete_id,
  stat: q.stat,
  keeperId,
  tappedAt: Date.parse(q.tapped_at),
  undoes: q.undoes,
});

/**
 * Tap can be forgotten locally only if it's queued, not being sent, and not already on the server
 * (a reopened board can still hold a queued copy of a tap an earlier board saved).
 */
export function canForgetLocally(
  targetId: string, queue: QueuedTap[], inFlight: ReadonlySet<string>, savedIds: ReadonlySet<string>,
): boolean {
  return queue.some((q) => q.id === targetId) && !inFlight.has(targetId) && !savedIds.has(targetId);
}

/** Taps the server doesn't have yet, in tap order: sent batches (older) then the queue. */
export function unsavedTaps(sent: QueuedTap[], queue: QueuedTap[], savedIds: ReadonlySet<string>): QueuedTap[] {
  return [...sent, ...queue].filter((t) => !savedIds.has(t.id));
}

/**
 * The keeper's newest tap of `athleteId` + `stat` that is neither an undo nor already undone: what holding that
 * stat button takes back. Keepers only ever undo their own taps.
 */
export function lastUndoable(saved: Tap[], queued: Tap[], keeperId: string, athleteId: string, stat: string): Tap | null {
  const undone = new Set([...saved, ...queued].map((t) => t.undoes));
  const live = (list: Tap[]) => list.filter((t) => t.keeperId === keeperId && t.athleteId === athleteId && t.stat === stat
    && t.undoes === null && !undone.has(t.id));
  // Queued taps are newer than anything saved, and saved times are skew-corrected while queued ones
  // are not, so never compare across the two lists. The queue is in tap order.
  const q = live(queued);
  if (q.length > 0) return q[q.length - 1];
  return live(saved).sort((a, b) => a.tappedAt - b.tappedAt).at(-1) ?? null;
}

/** Why holding a button took nothing off: someone else's taps make up the count, or there's nothing to take. */
export const subtractHint = (count: number) => (count > 0 ? 'Only your own taps can be removed.' : 'Already at 0.');
