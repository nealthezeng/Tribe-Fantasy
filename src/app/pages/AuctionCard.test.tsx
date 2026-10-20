// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuctionStage, BidRow } from '../lib/auction';
import { AuctionCard } from './AuctionCard';
import { api } from '../lib/rpc';
import { pairKey } from '../../core/week';
import { loadLeagueTournament } from '../lib/tournament';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  stages: [] as Row[],
  seasons: [{ settings: {} }] as Row[],
  athletes: [] as Row[],
  injuries: [] as Row[],
  bids: [] as Row[],
  credit_ledger: [{ amount: 115 }] as Row[],
}));
/** Tables whose rows the card has read, in the order it read them. */
const served = vi.hoisted(() => [] as string[]);

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
        then: (resolve: (v: { data: Row[]; error: null }) => void) => {
          served.push(table);
          resolve({ data: rows(), error: null });
        },
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

vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadLeagueTournament: vi.fn(async () => ({ result: { startedIn: {} } })),
}));

afterEach(cleanup);

beforeEach(() => {
  served.length = 0;
  db.stages = [];
  db.seasons = [{ settings: {} }];
  db.athletes = [];
  db.injuries = [];
  db.bids = [];
  db.credit_ledger = [{ amount: 115 }];
  vi.mocked(loadLeagueTournament).mockReset().mockResolvedValue({ result: { startedIn: {} } } as never);
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
    <MemoryRouter>
      <AuctionCard membershipId="m1" leagueId="l1" seasonId="se1" userId="u1"
        teamName="Test Zeal" getCredits />
    </MemoryRouter>,
  );
}

/** The card's load reads the ledger last; the request being seen is not the render, so also wait one macrotask for setData and the render. */
const loaded = async () => {
  await waitFor(() => expect(served).toContain('credit_ledger'));
  await new Promise((r) => setTimeout(r, 0));
};
const closedStage = { ...openStage, bid_close_at: '2026-10-10T00:00:00Z' } as unknown as Row;

describe('AuctionCard', () => {
  it('renders nothing when there is no stage yet', async () => {
    const { container } = renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });

  it('shows nothing on League once buying has closed', async () => {
    db.stages = [closedStage];
    const { container } = renderCard();
    await loaded();
    expect(container.textContent).toBe('');
    expect(loadLeagueTournament).not.toHaveBeenCalled();
  });

  it('shows the combined header with nothing bought yet, list open, no separate team card', async () => {
    db.stages = [openStage as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(document.body.textContent).toContain('115 credits left of 115');
    expect(document.body.textContent).toContain('0 of 6 players');
    expect(document.querySelector('details.section')!.hasAttribute('open')).toBe(true);
    expect(screen.getByRole('link', { name: 'Get more credits' })).toBeTruthy();
  });

  it('refuses an over-budget buy but allows raising your own within what you have left', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Alice') as unknown as Row, athlete('b', 'Bob') as unknown as Row];
    db.bids = [{ membership_id: 'm1', athlete_id: 'a', amount: 100 } satisfies BidRow as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(document.body.textContent).toContain('15 credits left of 115');

    fireEvent.change(screen.getByLabelText('Credits for shares in Bob'), { target: { value: '16' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    expect(api.placeBid).not.toHaveBeenCalled();
    expect(document.querySelector('.bid-header')!.className).toContain('over');

    fireEvent.change(screen.getByLabelText('Credits for shares in Alice'), { target: { value: '115' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.placeBid).toHaveBeenCalledWith('s1', 'm1', 'a', 115);
  });

  it('lists your buys first and turns Get more credits gold once you run low (t234, t237)', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Alice') as unknown as Row, athlete('b', 'Bob') as unknown as Row];
    db.bids = [{ membership_id: 'm1', athlete_id: 'b', amount: 110 } satisfies BidRow as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    expect([...document.querySelectorAll('li.bid-row .title')].map((t) => t.textContent)).toEqual(['Bob', 'Alice']);
    expect(screen.getByRole('link', { name: 'Get more credits' }).className).toBe('button'); // 5 left of 115
  });

  it('chips a player you started in an earlier tournament with the repeat factor; ×1 shows nothing', async () => {
    vi.mocked(loadLeagueTournament).mockResolvedValue({ result: { startedIn: { [pairKey('m1', 'a')]: ['s0'] } } } as never);
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Ari Banks') as unknown as Row, athlete('b', 'Bo Castellanos') as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    const row = (n: string) => within(screen.getByText(n).closest('li')!);
    // The repeat data loads apart from the buy list: wait for it.
    expect((await row('Ari Banks').findByText('×0.9')).getAttribute('aria-label')).toContain('Repeat factor ×0.9');
    expect(row('Bo Castellanos').queryByText(/^×/)).toBeNull();
  });

  it('still lists the players, without chips, when the tournament load fails', async () => {
    vi.mocked(loadLeagueTournament).mockRejectedValue(new Error('boom'));
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Ari Banks') as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    await waitFor(() => expect(loadLeagueTournament).toHaveBeenCalled());
    expect(screen.getByText('Ari Banks')).toBeTruthy();
    expect(screen.queryByText(/^×/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("doesn't move a row when you buy it: the order is fixed for the visit (t237)", async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Alice') as unknown as Row, athlete('b', 'Bob') as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    fireEvent.change(screen.getByLabelText('Credits for shares in Bob'), { target: { value: '10' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Buy' })[1]);
    await waitFor(() => expect(document.body.textContent).toContain('105 credits left of 115'));
    expect([...document.querySelectorAll('li.bid-row .title')].map((t) => t.textContent)).toEqual(['Alice', 'Bob']);
  });

  it('keeps the list open through your first buy', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('b', 'Bob') as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(document.querySelector('details.section')!.hasAttribute('open')).toBe(true);

    fireEvent.change(screen.getByLabelText('Credits for shares in Bob'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    await waitFor(() => expect(document.body.textContent).toContain('105 credits left of 115'));

    expect(document.querySelector('details.section')!.hasAttribute('open')).toBe(true);
  });

  it('reloads the balance from the ledger (not a stale prop) after an over-budget refusal', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Alice') as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(document.body.textContent).toContain('115 credits left of 115');

    db.credit_ledger = [{ amount: 165 }]; // a donation credited while the tab was open
    fireEvent.change(screen.getByLabelText('Credits for shares in Alice'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    expect(api.placeBid).not.toHaveBeenCalled();
    await waitFor(() => expect(document.body.textContent).toContain('165 credits left of 165'));
  });

  it("shows a refused buy's error on that player's row, and explains a balance lowered below your buys", async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Alice') as unknown as Row, athlete('b', 'Bob') as unknown as Row];
    db.bids = [{ membership_id: 'm1', athlete_id: 'a', amount: 100 } satisfies BidRow as unknown as Row];
    db.credit_ledger = [{ amount: 101 }];
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(document.body.textContent).toContain('1 credit left of 101');

    db.credit_ledger = [{ amount: 90 }]; // an admin cut the balance while the tab was open
    vi.mocked(api.placeBid).mockRejectedValueOnce(new Error('INSUFFICIENT_CREDITS'));
    fireEvent.change(screen.getByLabelText('Credits for shares in Alice'), { target: { value: '95' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const msg = await screen.findByText('Not enough credits for that.');
    expect(msg.closest('li')!.textContent).toContain('Alice');
    await screen.findByText('Buys are 10 credits over your balance.');
  });

  const player = (i: number, name = `P${i}`) => athlete(`p${i}`, name) as unknown as Row;
  const buy = (i: number, amount = 10) => ({ membership_id: 'm1', athlete_id: `p${i}`, amount }) as unknown as Row;

  it('says "N of 6 players", and locks every other row once you hold 6, with the hint', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [1, 2, 3, 4, 5, 6, 7].map((i) => player(i));
    db.bids = [buy(1), buy(2)];
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(document.body.textContent).toContain('2 of 6 players');
    expect(screen.getByText('Fall: buy shares')).toBeTruthy();
    expect((screen.getByLabelText('Credits for shares in P7') as HTMLInputElement).disabled).toBe(false);

    db.bids = [1, 2, 3, 4, 5, 6].map((i) => buy(i));
    cleanup();
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(document.body.textContent).toContain('6 of 6 players');
    expect((screen.getByLabelText('Credits for shares in P7') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Buy' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Up to 6 players. Remove one first.')).toBeTruthy();
    expect((screen.getByLabelText('Credits for shares in P1') as HTMLInputElement).disabled).toBe(false);
  });

  it('shows a refused 7th player with the number from settings', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [player(1)];
    renderCard();
    await screen.findByText(/^Closes in/);
    vi.mocked(api.placeBid).mockRejectedValueOnce(new Error('TOO_MANY_PLAYERS'));
    fireEvent.change(screen.getByLabelText('Credits for shares in P1'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    await screen.findByText('You can buy shares in up to 6 players. Remove one first.');
  });

  it('keeps a buy on a player who opted out so it can be removed', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [{ ...athlete('p1', 'Gone'), opted_in: false } as Row, player(2)];
    db.bids = [buy(1)];
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(document.body.textContent).toContain('1 of 6 players');
    expect(screen.getByLabelText('Credits for shares in Gone')).toBeTruthy();
    expect(screen.getByText('Opted out')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove Gone' })).toBeTruthy();
  });

  it('has no player-facing bid or auction wording while open', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [player(1), player(2)];
    db.bids = [buy(1)];
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(screen.queryByText(/\bbid|auction/i)).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/aria-label="[^"]*\b(bid|auction)/i);
  });
});
