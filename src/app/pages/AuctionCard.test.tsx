// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuctionStage, BidRow } from '../lib/auction';
import { AuctionCard } from './AuctionCard';
import { api } from '../lib/rpc';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  stages: [] as Row[],
  seasons: [{ settings: {} }] as Row[],
  athletes: [] as Row[],
  injuries: [] as Row[],
  bids: [] as Row[],
  roster_slots: [] as Row[],
  memberships: [] as Row[],
  credit_ledger: [{ amount: 115 }] as Row[],
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = () => (db as Record<string, Row[]>)[table] ?? [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        not: () => builder,
        order: () => builder,
        single: () => Promise.resolve({ data: rows()[0], error: null }),
        then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows(), error: null }),
      };
      return builder;
    },
  },
}));

vi.mock('../lib/rpc', () => ({
  api: {
    placeBid: vi.fn(async (_stageId: string, membershipId: string, athleteId: string, amount: number) => {
      const i = db.bids.findIndex((b) => b.membership_id === membershipId && b.athlete_id === athleteId);
      const row = { membership_id: membershipId, athlete_id: athleteId, amount };
      if (i >= 0) db.bids[i] = row; else db.bids.push(row);
    }),
    deleteBid: vi.fn(async () => {}),
  },
}));

afterEach(cleanup);

beforeEach(() => {
  db.stages = [];
  db.seasons = [{ settings: {} }];
  db.athletes = [];
  db.injuries = [];
  db.bids = [];
  db.roster_slots = [];
  db.memberships = [];
  db.credit_ledger = [{ amount: 115 }];
  vi.mocked(api.placeBid).mockClear();
  vi.mocked(api.deleteBid).mockClear();
});

const openStage: AuctionStage = {
  id: 's1', name: 'Fall', starts_on: '2026-10-18', ends_on: '2026-10-19', bid_close_at: new Date(Date.now() + 3_600_000).toISOString(),
  auction_seed: null, auction_run_at: null,
};
const athlete = (id: string, name: string) => ({ id, name, user_id: null, opted_in: true });

function renderCard() {
  return render(
    <AuctionCard membershipId="m1" leagueId="l1" seasonId="se1" userId="u1" joinedAt="2026-09-01T00:00:00Z"
      teamName="Test Zeal" subtitle="League A · Spring" team={<article>TEAM CARD</article>} wallet={<p>WALLET</p>} />,
  );
}

describe('AuctionCard', () => {
  it('renders only the team card when there is no stage yet', async () => {
    renderCard();
    await screen.findByText('TEAM CARD');
    expect(screen.queryByText(/auction/i)).toBeNull();
  });

  it('shows the combined header with nothing bid yet, list open, no separate team card', async () => {
    db.stages = [openStage as unknown as Row];
    renderCard();
    await screen.findByText('Bidding open');
    expect(document.body.textContent).toContain('115 credits left of 115');
    expect(document.body.textContent).toContain('0 players bid on · roster 4');
    expect(document.querySelector('details.section')!.hasAttribute('open')).toBe(true);
    expect(screen.queryByText('TEAM CARD')).toBeNull();
  });

  it('refuses an over-budget bid but allows raising your own bid within what you have left', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Alice') as unknown as Row, athlete('b', 'Bob') as unknown as Row];
    db.bids = [{ membership_id: 'm1', athlete_id: 'a', amount: 100 } satisfies BidRow as unknown as Row];
    renderCard();
    await screen.findByText('Bidding open');
    expect(document.body.textContent).toContain('15 credits left of 115');

    fireEvent.change(screen.getByLabelText('Your bid on Bob, in credits'), { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bid' }));
    expect(api.placeBid).not.toHaveBeenCalled();
    expect(document.querySelector('.bid-header')!.className).toContain('over');

    fireEvent.change(screen.getByLabelText('Your bid on Alice, in credits'), { target: { value: '115' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.placeBid).toHaveBeenCalledWith('s1', 'm1', 'a', 115);
  });

  it("keeps the bid list open through your first bid", async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('b', 'Bob') as unknown as Row];
    renderCard();
    await screen.findByText('Bidding open');
    expect(document.querySelector('details.section')!.hasAttribute('open')).toBe(true);

    fireEvent.change(screen.getByLabelText('Your bid on Bob, in credits'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bid' }));
    await waitFor(() => expect(document.body.textContent).toContain('105 credits left of 115'));

    expect(document.querySelector('details.section')!.hasAttribute('open')).toBe(true);
  });

  it('reloads the balance from the ledger (not a stale prop) after an over-budget refusal', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Alice') as unknown as Row];
    renderCard();
    await screen.findByText('Bidding open');
    expect(document.body.textContent).toContain('115 credits left of 115');

    db.credit_ledger = [{ amount: 165 }]; // a donation credited while the tab was open
    fireEvent.change(screen.getByLabelText('Your bid on Alice, in credits'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bid' }));
    expect(api.placeBid).not.toHaveBeenCalled();
    await waitFor(() => expect(document.body.textContent).toContain('165 credits left of 165'));
  });

  it('shows the team card plus a collapsed auction card before bidding opens', async () => {
    db.stages = [{ id: 's1', name: 'Fall', starts_on: '2026-10-18', bid_close_at: null, auction_seed: null, auction_run_at: null } as Row];
    renderCard();
    await screen.findByText('TEAM CARD');
    await waitFor(() => expect(document.querySelector('details.card')).not.toBeNull());
    const details = document.querySelector('details.card')!;
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary')!.textContent).toContain('Fall auction');
    expect(details.querySelector('summary')!.textContent).toContain('Not open yet');
  });
});
