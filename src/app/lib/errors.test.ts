import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('maps RPC codes to plain language', () => {
    expect(errorMessage({ message: 'INVALID_INVITE' })).toMatch(/invalid, expired, or used up/);
    expect(errorMessage(new Error('FORBIDDEN'))).toMatch(/permission/);
  });
  it('maps INVALID_INVITE_SETTINGS to plain language', () => {
    expect(errorMessage({ message: 'INVALID_INVITE_SETTINGS' })).toMatch(/max uses must be at least 1/);
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
    expect(errorMessage({ message: 'NOT_ENOUGH_ATHLETES', details: 'League A' })).toMatch(/^League A has more roster spots/);
    expect(errorMessage({ message: 'NOT_ENOUGH_ATHLETES' })).toMatch(/^A league has more roster spots/);
  });
  it('has plain language for every code the tournament migration raises', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../../../supabase/migrations/0012_tournament.sql', import.meta.url), 'utf8');
    const codes = [...new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]))];
    expect(codes.length).toBeGreaterThan(10);
    expect(codes.filter((c) => errorMessage({ message: c }).startsWith('Something went wrong'))).toEqual([]);
  });
  it('falls back to the raw message', () => {
    expect(errorMessage({ message: 'socket hang up' })).toBe('Something went wrong (socket hang up). Try again, and tell an admin if it keeps happening.');
    expect(errorMessage('boom')).toMatch(/^Something went wrong \(boom\)/);
  });
});
