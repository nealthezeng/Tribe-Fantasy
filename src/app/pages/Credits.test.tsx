// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LedgerEntry } from '../lib/wallet';
import { Credits } from './Credits';

afterEach(cleanup);

const NOW = Date.parse('2026-10-10T20:00:00Z');
const entry = (id: number, kind: LedgerEntry['kind'], amount: number, created_at: string, dollars: number | null = null): LedgerEntry =>
  ({ id, kind, amount, dollars, note: null, created_at, stages: { name: 'Fall Beta' } });
const donate = { code: 'BKRT', handle: 'tribe-fund', creditsPerDollar: 20 };
const show = (entries: LedgerEntry[], d: typeof donate | null = donate) =>
  render(<MemoryRouter><Credits entries={entries} donate={d} now={NOW} /></MemoryRouter>);
const venmo = () => new URL((screen.getByRole('link', { name: /on Venmo/ }) as HTMLAnchorElement).href);

describe('Credits (t224, t225)', () => {
  it('shows the balance and a Venmo link with the code in the note and the chosen amount', () => {
    show([entry(1, 'allowance', 115, '2026-10-03T00:00:00Z')]);
    expect(screen.getByRole('article', { name: 'Credits' }).textContent).toContain('115 credits');
    expect(venmo().searchParams.get('recipients')).toBe('tribe-fund');
    expect(venmo().searchParams.get('note')).toBe('Tribe Fantasy BKRT');
    expect(venmo().searchParams.get('audience')).toBe('private');
    expect(venmo().searchParams.get('amount')).toBe('10');
    fireEvent.click(screen.getByRole('button', { name: /\$20/ }));
    expect(venmo().searchParams.get('amount')).toBe('20');
    expect(screen.getByRole('button', { name: /\$20/ }).textContent).toContain('400 credits');
  });

  it('says it is a donation to the team fund with no cash value and no guaranteed prize (PRODUCT.md)', () => {
    show([]);
    expect(document.body.textContent).toMatch(/donation to the team fund/);
    expect(document.body.textContent).toMatch(/no cash value/);
    expect(document.body.textContent).toMatch(/no guaranteed prize/);
    // Read before paying: the terms come right after the Venmo button (t233).
    expect(screen.getByRole('link', { name: /on Venmo/ }).nextElementSibling?.textContent).toMatch(/team fund.*no guaranteed prize/);
  });

  it('thanks a fresh donation, but not one older than a week or followed by other credits', () => {
    show([entry(1, 'allowance', 115, '2026-10-03T00:00:00Z'), entry(2, 'donation', 200, '2026-10-10T18:00:00Z', 10)]);
    expect(screen.getByText('Thanks for the $10! 200 credits added.')).toBeTruthy();
    cleanup();
    show([entry(2, 'donation', 200, '2026-09-01T00:00:00Z', 10)]);
    expect(screen.queryByText(/Thanks for/)).toBeNull();
    cleanup();
    show([entry(2, 'donation', 200, '2026-10-10T18:00:00Z', 10), entry(3, 'bid', -30, '2026-10-10T19:00:00Z')]);
    expect(screen.queryByText(/Thanks for/)).toBeNull();
  });

  it('copies the code and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    show([]);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith('BKRT');
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Copied/));
  });

  it('tells you to type the code when the clipboard is unavailable', async () => {
    Object.assign(navigator, { clipboard: undefined });
    show([]);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe("Couldn't copy. Type BKRT in the Venmo note."));
  });

  it('shows only the balance and history while the season takes no donations', () => {
    show([entry(1, 'allowance', 115, '2026-10-03T00:00:00Z')], null);
    expect(screen.queryByRole('link', { name: /on Venmo/ })).toBeNull();
    expect(screen.getByText('Credit history')).toBeTruthy();
  });
});
