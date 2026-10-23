import type { SeasonSettings } from '../../core/settings';
import type { GameOutcome, GameStatus } from '../../core/tournament';
import type { LeagueTournament } from './tournament';

// Every player-facing game name, stat sentence, rest phrase and status word (P9 rulings 1–4, 10).

/** "Game 3", or "Game 3 vs UNC" once a keeper names the real opponent. */
export const gameName = (number: number, opponent?: string | null): string =>
  (opponent ? `Game ${number} vs ${opponent}` : `Game ${number}`);

const STAT_ORDER = ['goal', 'assist', 'block', 'callahan', 'turnover'];

/** "1 goal, 2 assists, 1 block" in tally order; '' when every count is 0. */
export const statWords = (stats: Record<string, number>): string =>
  STAT_ORDER.filter((k) => stats[k] > 0).map((k) => `${stats[k]} ${k}${stats[k] === 1 ? '' : 's'}`).join(', ');

export const STAT_LEGEND = 'G goals · A assists · D blocks · C callahans · T turnovers';

/** A factor as an exact percent to 3 significant figures: 0.125 → "12.5%", 0.2 → "20%". */
export const pctExact = (x: number): string => `${Number((x * 100).toPrecision(3))}%`;

const FRACTION: Record<number, string> = { 0.5: 'half', 0.75: '¾', 0.25: '¼' };

/**
 * A player's rest before game `number`: "rested", or "played game 2: half points". `tiredness_multipliers[i]` is the
 * rest of a player who started i + 1 games before. When the list holds `rest` twice (or not at all) the game is
 * unknown, so the words give the points alone: "half points".
 */
export function restWords(rest: number, number: number, s: SeasonSettings): string {
  if (rest === 1) return 'rested';
  const points = `${FRACTION[rest] ?? pctExact(rest)} points`;
  const i = s.tiredness_multipliers.indexOf(rest);
  return i === -1 || i !== s.tiredness_multipliers.lastIndexOf(rest) ? points : `played game ${number - 1 - i}: ${points}`;
}

export type StatusWord = 'Not started' | 'Live' | 'Finished · not verified' | 'Final' | "Doesn't count";

const STATUS: Record<GameStatus, StatusWord> = {
  upcoming: 'Not started', live: 'Live', pending: 'Finished · not verified', final: 'Final', void: "Doesn't count",
};

/** A verified game held back by an earlier unverified one reads "Final" (with `heldNote`). */
export const statusWord = (g: Pick<GameOutcome, 'status' | 'heldBy'>): StatusWord => (g.heldBy ? 'Final' : STATUS[g.status]);

/** "counts once Feasterns game 4 is verified" for a game the core held back; null otherwise. */
export function heldNote(y: Pick<LeagueTournament, 'result' | 'stage'>, g: GameOutcome): string | null {
  const h = g.heldBy && y.result.games.find((x) => x.game.id === g.heldBy);
  return h ? `counts once ${y.stage.get(h.game.stageId) ?? ''} game ${h.game.number} is verified` : null;
}

/** A Stats or tally row's status word from its game and session rows; started with no session = "Doesn't count". */
export const rowStatus = (g: { started_at: string | null; finished_at: string | null; session_id: string | null; verified_at: string | null }): StatusWord =>
  STATUS[g.started_at === null ? 'upcoming' : g.session_id === null ? 'void' : g.verified_at ? 'final' : g.finished_at === null ? 'live' : 'pending'];
