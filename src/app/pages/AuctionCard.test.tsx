// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuctionStage, BidRow } from '../lib/auction';
import { AuctionCard } from './AuctionCard';
import { api } from '../lib/rpc';
import { pairKey } from '../../core/week';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { loadLeagueTournament } from '../lib/tournament';
import { todayLocal } from '../lib/stats';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  stages: [] as Row[],
  seasons: [{ settings: {} }] as Row[],
  athletes: [] as Row[],
  outs: [] as Row[],
  bids: [] as Row[],
  credit_ledger: [] as Row[],
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
  loadLeagueTournament: vi.fn(),
}));

/** A real-shaped league tournament with no games; `over` replaces top-level fields. */
const tournament = (over: Record<string, unknown> = {}) => ({
  settings: DEFAULT_SETTINGS, input: { statLines: [] }, result: { games: [], startedIn: {} },
  stage: new Map(), stageDates: new Map(), ...over,
}) as never;

afterEach(cleanup);

beforeEach(() => {
  served.length = 0;
  db.stages = [];
  db.seasons = [{ settings: {} }];
  db.athletes = [];
  db.outs = [];
  db.bids = [];
  db.credit_ledger = [allowance];
  vi.mocked(loadLeagueTournament).mockReset().mockResolvedValue(tournament());
  vi.mocked(api.placeBid).mockClear();
  vi.mocked(api.deleteBid).mockClear();
});

const openStage: AuctionStage = {
  id: 's1', name: 'Fall', starts_on: '2026-10-18', ends_on: '2026-10-19', bid_close_at: new Date(Date.now() + 3_600_000).toISOString(),
  auction_seed: null, auction_run_at: null,
};
const athlete = (id: string, name: string) => ({ id, name, user_id: null, opted_in: true });
/** The team's free credits for the open stage. */
const allowance: Row = { amount: 115, kind: 'allowance', stage_id: 's1', created_at: '2026-10-01T00:00:00Z' };
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
/** An admin's credits by hand (Wallets › adjust credits): no stage. */
const adjustment = (amount: number, days: number): Row => ({ amount, kind: 'adjustment', stage_id: null, created_at: daysAgo(days) });

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

  it('says Buying closed once while shares wait to be settled', async () => {
    db.stages = [closedStage];
    const { container } = renderCard();
    await loaded();
    expect(await screen.findByText('Buying closed for Fall. Once shares are settled, your players and game 1 picks show here.')).toBeTruthy();
    expect(container.textContent!.match(/Buying closed/g)).toHaveLength(1);
    expect(loadLeagueTournament).not.toHaveBeenCalled();
  });

  it('shows nothing once the shares are settled', async () => {
    db.stages = [{ ...closedStage, auction_run_at: '2026-10-11T00:00:00Z' }];
    const { container } = renderCard();
    await loaded();
    expect(container.textContent).toBe('');
  });

  it('explains buying shares from the card head', async () => {
    db.stages = [openStage as unknown as Row];
    renderCard();
    const help = await screen.findByRole('button', { name: 'How buying shares works' });
    expect(help.closest('.head')).toBeTruthy();
    expect(help.nextElementSibling!.textContent).toBe('Your credits buy a slice of a player. Each player is 200 shares: '
      + '40 credits buys 40 of them, so you own 20% and score 20% of his points. If teams put more than 200 credits on one '
      + 'player, every slice shrinks to fit. Free credits arrive before each tournament; unspent ones carry over.');
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

  it('shows Out on the buy list for players out this tournament', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a1', 'A1') as unknown as Row, athlete('a2', 'A2') as unknown as Row];
    db.outs = [{ stage_id: 's1', athlete_id: 'a1', until_game: null }];
    renderCard();
    await screen.findByText(/^Closes in/);
    const row = (n: string) => screen.getByText(n).closest('li')!;
    expect(row('A1').textContent).toContain('Out');
    expect(row('A2').textContent).not.toContain('Out');
    expect(document.body.textContent).not.toContain('Injured');
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

  it('chips a player you picked in an earlier tournament with the repeat factor; ×1 shows nothing', async () => {
    vi.mocked(loadLeagueTournament).mockResolvedValue(tournament({ result: { games: [], startedIn: { [pairKey('m1', 'a')]: ['s0'] } } }));
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Ari Banks') as unknown as Row, athlete('b', 'Bo Castellanos') as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    const row = (n: string) => within(screen.getByText(n).closest('li')!);
    // The repeat data loads apart from the buy list: wait for it.
    expect((await row('Ari Banks').findByText('×0.9')).getAttribute('aria-label')).toBe('picked in an earlier tournament: 90%');
    expect(row('Bo Castellanos').queryByText(/^×/)).toBeNull();
  });

  it("shows each player's points a game at the last tournament, the name linking to their games", async () => {
    const g = (id: string) => ({ game: { id, stageId: 'B', number: 1, sessionId: `s${id}` }, status: 'final' });
    vi.mocked(loadLeagueTournament).mockResolvedValue(tournament({
      result: { games: [g('g1'), g('g2')], startedIn: {} },
      input: { statLines: [{ sessionId: 'sg1', athleteId: 'a', stats: { goal: 2 }, pointsPlayed: 5 }, { sessionId: 'sg2', athleteId: 'a', stats: { assist: 1 }, pointsPlayed: 5 }] },
      stage: new Map([['B', 'B']]), stageDates: new Map([['B', { starts_on: '2026-02-01', ends_on: '2026-02-02' }]]),
    }));
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Ari Banks') as unknown as Row, athlete('b', 'Bo Castellanos') as unknown as Row];
    renderCard();
    expect(await screen.findByText('Points a game at B, the last tournament. Tap a name for game by game.')).toBeTruthy();
    const row = (n: string) => within(screen.getByText(n).closest('li')!);
    expect(await row('Ari Banks').findByText('4.5 a game')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ari Banks' }).getAttribute('href')).toBe('/player/a?t=B');
    expect(row('Bo Castellanos').queryByText(/a game/)).toBeNull();
  });

  it('shows the plain list when there is no last tournament', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Ari Banks') as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    await waitFor(() => expect(loadLeagueTournament).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(/Points a game at/)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Ari Banks' })).toBeNull();
    expect(screen.getByText('Ari Banks')).toBeTruthy();
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
    const over = await screen.findByText('Buys are 10 credits over your balance.');
    // The error sits right under the header, before the advice (ruling 83).
    expect(over.previousElementSibling!.className).toContain('bid-header');
    expect(over.nextElementSibling!.textContent).toBe('Picks for game 1 open here once shares are settled.');
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

  it('says nothing extra about credits: none for this tournament, or credits an admin added by hand (ruling 76)', async () => {
    db.stages = [{ ...openStage, name: 'CCCs' } as unknown as Row];
    // No credits at all, an earlier tournament's only, and an admin's hand-added credits from yesterday.
    for (const ledger of [[], [{ ...allowance, stage_id: 's0' }], [allowance, adjustment(115, 1)]]) {
      db.credit_ledger = ledger;
      cleanup();
      renderCard();
      await screen.findByText(/^Closes in/);
      expect(screen.queryByText(/joined after|ask an admin|admin added/i)).toBeNull();
      expect(document.querySelector('article > :is(.notice, .success)')).toBeNull();
    }
  });

  it('confirms a saved buy on its row', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Ari Banks') as unknown as Row, athlete('b', 'Bo Castellanos') as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    fireEvent.change(screen.getByLabelText('Credits for shares in Ari Banks'), { target: { value: '40' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Buy' })[0]);
    const saved = await screen.findByText('Saved: 40 credits on Ari Banks.');
    expect(saved.tagName).toBe('SMALL');
    expect(saved.className).toBe('success');
    expect(saved.closest('li')!.textContent).toContain('Ari Banks');

    // Until the next save anywhere.
    fireEvent.change(screen.getByLabelText('Credits for shares in Bo Castellanos'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buy' }));
    expect((await screen.findByText('Saved: 1 credit on Bo Castellanos.')).closest('li')!.textContent).toContain('Bo Castellanos');
    expect(screen.queryByText('Saved: 40 credits on Ari Banks.')).toBeNull();
  });

  it('keeps a number typed in one row while another row saves', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [athlete('a', 'Alice') as unknown as Row, athlete('b', 'Bob') as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    fireEvent.change(screen.getByLabelText('Credits for shares in Alice'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Credits for shares in Bob'), { target: { value: '10' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Buy' })[1]);
    await waitFor(() => expect(document.body.textContent).toContain('105 credits left of 115'));
    expect((screen.getByLabelText('Credits for shares in Alice') as HTMLInputElement).value).toBe('20');
  });

  const TIRED = 'You pick 2 players a game, and a player you picked for the game before scores half. Buying 6 lets you rotate them.';

  it('says why to buy a full roster while you have fewer than 6', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [1, 2, 3, 4, 5, 6, 7].map((i) => player(i));
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(screen.getByText(TIRED).className).toBe('hint');

    db.bids = [1, 2, 3, 4, 5, 6].map((i) => buy(i));
    cleanup();
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(screen.queryByText(TIRED)).toBeNull();

    db.bids = [];
    db.seasons = [{ settings: { tiredness_multipliers: [] } }];
    cleanup();
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(screen.queryByText(/a player you picked/)).toBeNull();

    // As many picks a game as players: nothing to rotate.
    db.seasons = [{ settings: { roster_size: 2 } }];
    cleanup();
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(document.body.textContent).toContain('0 of 2 players');
    expect(screen.queryByText(/a player you picked/)).toBeNull();
  });

  it('shows the most of a player each buy can own', async () => {
    db.stages = [openStage as unknown as Row];
    db.athletes = [player(1), player(2), player(3)];
    db.bids = [buy(1, 40), buy(2, 250)];
    renderCard();
    await screen.findByText(/^Closes in/);
    const row = (n: string) => screen.getByText(n).closest('li')!;
    expect(within(row('P1')).getByText('You own up to 20%').tagName).toBe('SMALL');
    expect(within(row('P2')).getByText('You own up to 100%')).toBeTruthy();
    expect(row('P3').textContent).not.toContain('You own');
  });

  it('says when the tournament starts and when picks open while buying is open', async () => {
    db.stages = [{ ...openStage, starts_on: '2099-10-24' } as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(screen.getByText('Fall starts Sat, Oct 24. Picks for game 1 open here once shares are settled.').className).toBe('hint');

    db.stages = [{ ...openStage, starts_on: todayLocal() } as unknown as Row]; // its first day
    cleanup();
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(screen.getByText('Fall starts today. Picks for game 1 open here once shares are settled.')).toBeTruthy();

    db.stages = [openStage as unknown as Row]; // started 2026-10-18, before today
    cleanup();
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(screen.getByText('Picks for game 1 open here once shares are settled.')).toBeTruthy();
    expect(screen.queryByText(/Fall starts/)).toBeNull();
  });

  it('says what comes after buying closes', async () => {
    db.stages = [{ ...closedStage, starts_on: '2099-10-24' }];
    renderCard();
    await loaded();
    expect(await screen.findByText('Buying closed for Fall. Once shares are settled, your players and game 1 picks show here. '
      + 'Fall starts Sat, Oct 24.')).toBeTruthy();
    db.stages = [{ ...closedStage, starts_on: todayLocal() }];
    cleanup();
    renderCard();
    expect(await screen.findByText(/Fall starts today\.$/)).toBeTruthy();
  });

  it('reloads when the app comes back on screen', async () => {
    db.stages = [openStage as unknown as Row];
    db.credit_ledger = [];
    renderCard();
    await screen.findByText(/^Closes in/);
    expect(document.body.textContent).toContain('credits left of 0');

    db.credit_ledger = [allowance]; // credited while the phone was in another app
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(document.body.textContent).toContain('credits left of 115'));
  });

  it('shows a close that passed while the app was away as soon as it comes back', async () => {
    db.stages = [openStage as unknown as Row];
    renderCard();
    await screen.findByText(/^Closes in/);
    vi.useFakeTimers({ toFake: ['Date'] }); // only the clock jumps; waitFor keeps real timers
    try {
      vi.setSystemTime(Date.now() + 2 * 3_600_000); // past bid_close_at, well before the next 15 s tick
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(await screen.findByText(/^Buying closed for Fall\./)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
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
