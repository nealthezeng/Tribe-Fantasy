import { describe, expect, it } from 'vitest';
import { sessionState, statLabel, toCsv, todayLocal } from './stats';

describe('stats helpers', () => {
  it('labels the five stats and falls back to the key', () => {
    expect(statLabel('block')).toBe('D');
    expect(statLabel('layout')).toBe('layout');
  });

  it('derives open / verified / locked from verified_at and the lock length', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    expect(sessionState({ verified_at: null }, 48, now)).toBe('open');
    expect(sessionState({ verified_at: '2026-11-17T12:00:00Z' }, 48, now)).toBe('verified');
    expect(sessionState({ verified_at: '2026-11-16T12:00:00Z' }, 48, now)).toBe('locked');
  });

  it('writes CSV that survives commas, quotes and formula-looking names', () => {
    expect(toCsv([['name', 'goal'], ['Sam, "Sparky"', 2], ['=HYPERLINK("x")', 0]])).toBe(
      'name,goal\r\n"Sam, ""Sparky""",2\r\n"\'=HYPERLINK(""x"")",0',
    );
  });

  it('formats today as YYYY-MM-DD', () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
