// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VenmoReceipts } from './VenmoReceipts';
import type { VenmoReceiptList } from '../../lib/rpc';

const list = vi.hoisted(() => ({ value: { receipts: [], skipped: 0 } as VenmoReceiptList }));
vi.mock('../../lib/rpc', () => ({ api: { listVenmoReceipts: () => Promise.resolve(list.value) } }));

afterEach(cleanup);

describe('VenmoReceipts', () => {
  it('lists receipts that did not become credits, in plain words', async () => {
    list.value = {
      skipped: 3,
      receipts: [
        { id: 2, received_at: '2026-11-01T15:00:00Z', status: 'unknown_code', payer: 'Jane Doe', dollars: 10, note: 'for GRRR',
          code: 'GRRR', team: null },
        { id: 1, received_at: '2026-11-01T14:00:00Z', status: 'unsigned', payer: null, dollars: null, note: null, code: null, team: null },
      ],
    };
    render(<VenmoReceipts />);
    expect(await screen.findByText(/Venmo receipts not credited \(2\)/)).toBeTruthy();
    expect(document.body.textContent).toContain('No team has that code');
    expect(document.body.textContent).toContain('Not a verified Venmo receipt sent to our Venmo');
    expect(document.body.textContent).toContain('Jane Doe');
    expect(document.body.textContent).toContain('$10.00');
    expect(document.body.textContent).toContain('3 other Venmo payments without a team code were skipped');
  });

  it('says "1 payment was" for a single skipped payment', async () => {
    list.value = { skipped: 1, receipts: [] };
    render(<VenmoReceipts />);
    await screen.findByText(/Venmo receipts not credited \(0\)/);
    expect(document.body.textContent).toContain('1 other Venmo payment without a team code was skipped');
  });

  it('shows no count until the list has loaded', () => {
    list.value = { skipped: 0, receipts: [] };
    render(<VenmoReceipts />);
    expect(screen.getByText('Venmo receipts not credited')).toBeTruthy();
  });

  it('says so when everything was credited', async () => {
    list.value = { skipped: 0, receipts: [] };
    render(<VenmoReceipts />);
    expect(await screen.findByText(/Venmo receipts not credited \(0\)/)).toBeTruthy();
    expect(document.body.textContent).toContain('Every Venmo donation in the last 30 days was credited.');
  });
});
