import { describe, expect, it } from 'vitest';
import { stuckGames } from './adminWarnings';
import type { GameRow } from './tournament';

const TODAY = '2026-10-23';
const STAGES = [
  { id: 'fe', name: 'Feasterns', ends_on: '2026-10-09' },
  { id: 'cc', name: 'CCCs', ends_on: TODAY }, // its last day is today: not over yet
];
const game = (id: string, stage_id: string, number: number, o: Partial<GameRow> = {}): GameRow => ({
  id, stage_id, number, session_id: `s-${id}`, started_at: '2026-10-08T14:00:00Z', finished_at: '2026-10-08T15:30:00Z', opponent: null, ...o,
});

describe('stuckGames (P9 ruling 18)', () => {
  it('flags a game still live after its tournament ended', () => {
    const games = [game('g4', 'fe', 4, { finished_at: null })];
    expect(stuckGames(STAGES, games, [{ id: 's-g4', verified_at: null }], TODAY))
      .toEqual([{ stage: 'Feasterns', number: 4, sessionId: 's-g4', live: true }]);
  });

  it('flags a finished game nobody verified, and skips a verified one', () => {
    const games = [game('g3', 'fe', 3), game('g2', 'fe', 2)];
    const sessions = [{ id: 's-g3', verified_at: null }, { id: 's-g2', verified_at: '2026-10-09T10:00:00Z' }];
    expect(stuckGames(STAGES, games, sessions, TODAY)).toEqual([{ stage: 'Feasterns', number: 3, sessionId: 's-g3', live: false }]);
  });

  it("leaves the current tournament's unverified games alone", () => {
    const games = [game('c1', 'cc', 1, { finished_at: null }), game('c2', 'cc', 2)];
    expect(stuckGames(STAGES, games, [{ id: 's-c1', verified_at: null }, { id: 's-c2', verified_at: null }], TODAY)).toEqual([]);
  });

  it('skips a void game (its session deleted) and one that never started', () => {
    const games = [
      game('g1', 'fe', 1, { session_id: null }),
      game('g2', 'fe', 2), // session row gone
      game('g5', 'fe', 5, { session_id: null, started_at: null, finished_at: null }),
    ];
    expect(stuckGames(STAGES, games, [], TODAY)).toEqual([]);
  });
});
