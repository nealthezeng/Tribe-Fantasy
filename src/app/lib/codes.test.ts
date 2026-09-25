import { describe, expect, it } from 'vitest';
import { randomCode } from './codes';

describe('randomCode', () => {
  it('produces invite-safe codes without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const c = randomCode();
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
    expect(randomCode(12)).toHaveLength(12);
  });
});
