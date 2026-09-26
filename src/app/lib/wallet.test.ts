import { describe, expect, it } from 'vitest';
import { balance, entryLabel, type LedgerEntry } from './wallet';

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  id: 1, kind: 'allowance', amount: 115, dollars: null, note: null, created_at: '2026-10-18T12:00:00Z', stages: null, ...over,
});

describe('wallet', () => {
  it('sums a balance', () => {
    expect(balance([entry({ amount: 115 }), entry({ amount: 250 }), entry({ amount: -10 })])).toBe(355);
    expect(balance([])).toBe(0);
  });

  it('says a donation is a donation to the team', () => {
    expect(entryLabel(entry({ kind: 'donation', amount: 250, dollars: '12.50' }))).toBe('Donation to the team — $12.50');
    expect(entryLabel(entry({ kind: 'allowance', stages: { name: 'Fall beta' } }))).toBe('Allowance — Fall beta');
    expect(entryLabel(entry({ kind: 'adjustment', amount: -10, note: 'double allowance' }))).toBe('Adjustment — double allowance');
  });
});
