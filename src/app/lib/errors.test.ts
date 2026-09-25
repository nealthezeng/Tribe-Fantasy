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
  it('falls back to the raw message', () => {
    expect(errorMessage({ message: 'socket hang up' })).toBe('Something went wrong: socket hang up');
    expect(errorMessage('boom')).toBe('Something went wrong: boom');
  });
});
