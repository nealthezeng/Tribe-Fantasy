import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('maps RPC codes to plain language', () => {
    expect(errorMessage({ message: 'ALREADY_MEMBER' })).toMatch(/already in this league/);
    expect(errorMessage(new Error('FORBIDDEN'))).toMatch(/permission/);
  });
  it('maps the open-league codes (t215)', () => {
    for (const code of ['NO_SEASON', 'INVALID_PASSWORD', 'WRONG_PASSWORD', 'CREATE_LIMIT', 'NOT_LEAGUE_OWNER',
      'LEAGUE_HAS_TEAMS', 'LEAGUE_HAS_DONATIONS', 'TEAM_HAS_DONATIONS', 'TEAM_HAS_BIDS', 'TEAM_HAS_GAMES']) {
      expect(errorMessage({ message: code }), code).not.toMatch(/Something went wrong/);
    }
    expect(errorMessage({ message: 'WRONG_PASSWORD' })).toMatch(/Ask the league's creator/);
    // Leaving is refused as soon as the team is paired, before the game is played.
    expect(errorMessage({ message: 'TEAM_HAS_GAMES' })).toMatch(/paired for a game/);
  });
  it('maps the M3 stats codes', () => {
    expect(errorMessage({ message: 'VERIFIER_TAPPED' })).toMatch(/another keeper has to verify/);
    expect(errorMessage({ message: 'NOT_YOUR_ATHLETE' })).toMatch(/your own attendance/);
  });
  it('maps the M4 wallet codes', () => {
    expect(errorMessage({ message: 'LEAGUE_FULL' })).toMatch(/full/);
    expect(errorMessage({ message: 'DONATIONS_DISABLED' })).toMatch(/donations to the team/);
  });
  it('maps the M5 auction codes, naming the league that is short', () => {
    expect(errorMessage({ message: 'BID_CLOSED' })).toMatch(/has closed/);
    expect(errorMessage({ message: 'INSUFFICIENT_CREDITS' })).toMatch(/Not enough credits/);
    expect(errorMessage({ message: 'NOT_ENOUGH_ATHLETES' })).toBe('No healthy players are opted in.');
    expect(errorMessage({ message: 'TOO_MANY_PLAYERS' }, '6')).toBe('You can buy shares in up to 6 players. Remove one first.');
  });
  it('has plain language for every code the tournament and shares migrations raise', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = ['0012_tournament.sql', '0023_shares.sql']
      .map((f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8')).join('\n');
    // set_bench and swap_bench went with the bench (0023, C3).
    const bench = ['TOURNAMENT_STARTED', 'TOURNAMENT_NOT_STARTED', 'BENCH_SIZE', 'NOT_ACTIVE', 'NOT_ON_BENCH', 'NOT_INJURED', 'SWAP_USED'];
    const codes = [...new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]))].filter((c) => !bench.includes(c));
    expect(codes.length).toBeGreaterThan(10);
    expect(codes.filter((c) => errorMessage({ message: c }).startsWith('Something went wrong'))).toEqual([]);
  });
  it('says how many picks a game takes (M13)', () => {
    expect(errorMessage({ message: 'TOO_MANY_PICKS' }, '2')).toBe('You already have 2 picks. Clear one first.');
  });
  it('falls back to the raw message', () => {
    expect(errorMessage({ message: 'socket hang up' })).toBe('Something went wrong (socket hang up). Try again, and tell an admin if it keeps happening.');
    expect(errorMessage('boom')).toMatch(/^Something went wrong \(boom\)/);
  });
});
