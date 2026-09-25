import { describe, expect, it } from 'vitest';
import { readAuthRedirectError } from './authRedirectError';

describe('readAuthRedirectError', () => {
  it('reads error_description from the query string', () => {
    expect(
      readAuthRedirectError('?error=access_denied&error_description=Email+link+is+invalid+or+has+expired', '#/'),
    ).toBe('Email link is invalid or has expired');
  });

  it('reads error_description from the hash when it starts with #error=', () => {
    expect(
      readAuthRedirectError('', '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired'),
    ).toBe('Email link is invalid or has expired');
  });

  it('returns null for a normal #/join hash', () => {
    expect(readAuthRedirectError('', '#/join')).toBeNull();
  });

  it('returns null when there are no params at all', () => {
    expect(readAuthRedirectError('', '')).toBeNull();
    expect(readAuthRedirectError('', '#/')).toBeNull();
  });
});
