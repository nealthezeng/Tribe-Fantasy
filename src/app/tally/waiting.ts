import type { VoiceEvent } from '../../core/voice';
import { statLabel } from '../lib/stats';
import { inStatOrder } from '../lib/words';
import type { QueuedTap } from './queue';

// Stats heard by voice wait on the board until the keeper taps Add (M16 §5.4). Never stored on the phone.

/** One waiting stat; `at` is when the call that put it there started. */
export interface WaitingStat { athleteId: string; stat: string; at: string }
/** The last call's words, the players in the order first named (each with that call's start), and their stats. */
export interface WaitingSet { heard: string; players: { athleteId: string; at: string }[]; stats: WaitingStat[] }
/** A message by the mic; `alert` for voice that failed, `undo` puts back what was just dropped. */
export type VoiceNote = { text: string; undo?: () => void; alert?: boolean };

/** Adds a call's events (at least one) to the set: new players at the end, every stat at this call's start. */
export function joinCall(set: WaitingSet | null, events: VoiceEvent[], text: string, at: string): WaitingSet {
  const players = [...(set?.players ?? [])];
  for (const { athleteId } of events) if (!players.some((p) => p.athleteId === athleteId)) players.push({ athleteId, at });
  return { heard: text, players, stats: [...(set?.stats ?? []), ...events.map(({ athleteId, stat }) => ({ athleteId, stat, at }))] };
}

/** One more waiting stat, tapped on a Heard card: a fix to the call, so it gets the start of the player's call. */
export function bump(set: WaitingSet, athleteId: string, stat: string): WaitingSet {
  const at = set.players.find((p) => p.athleteId === athleteId)?.at ?? new Date().toISOString();
  return { ...set, stats: [...set.stats, { athleteId, stat, at }] };
}

/** Takes the newest such waiting stat off; null when none waits. The player stays in the group at zero. */
export function drop(set: WaitingSet, athleteId: string, stat: string): WaitingSet | null {
  const i = set.stats.map((s) => s.athleteId === athleteId && s.stat === stat).lastIndexOf(true);
  return i < 0 ? null : { ...set, stats: set.stats.filter((_, j) => j !== i) };
}

export const waitingCount = (set: WaitingSet, athleteId: string, stat: string): number =>
  set.stats.filter((s) => s.athleteId === athleteId && s.stat === stat).length;

/** What Add sends: the stats of players this keeper may tally now. */
export const addable = (set: WaitingSet, canAdd: (athleteId: string) => boolean): WaitingStat[] =>
  set.stats.filter((s) => canAdd(s.athleteId));

export const toQueued = (stats: WaitingStat[]): QueuedTap[] =>
  stats.map((s) => ({ id: crypto.randomUUID(), athlete_id: s.athleteId, stat: s.stat, tapped_at: s.at, undoes: null }));

/** "Toby Grant Assist, Max Ortiz Goal ×2": players in the order they first appear, then the board's stat order. */
export function listStats(stats: WaitingStat[], nameOf: (id: string) => string): string {
  return [...new Set(stats.map((s) => s.athleteId))].flatMap((id) => {
    const mine = stats.filter((s) => s.athleteId === id).map((s) => s.stat);
    return inStatOrder([...new Set(mine)]).map((stat) => {
      const n = mine.filter((s) => s === stat).length;
      return `${nameOf(id)} ${statLabel(stat)}${n > 1 ? ` ×${n}` : ''}`;
    });
  }).join(', ');
}
