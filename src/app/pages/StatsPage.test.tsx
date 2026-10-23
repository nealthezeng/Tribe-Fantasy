// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HashRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storeQueue, type QueuedTap } from '../tally/queue';
import { gameName } from '../lib/words';
import { StatsPage } from './StatsPage';

const m = vi.hoisted(() => ({
  isKeeper: true,
  signedIn: true,
  loading: false,
  isAdmin: false,
  season: { id: 'se', name: 'Spring', settings: { stat_weights: { goal: 3, assist: 2 }, stat_lock_hours: 1 } } as { id: string; name: string; settings: unknown } | null,
  load: vi.fn(),
  real: null as null | ((...a: unknown[]) => unknown),
  rpc: vi.fn(),
  tables: {} as Record<string, unknown[]>,
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: m.isAdmin, isKeeper: m.isKeeper, loading: m.loading, session: m.signedIn ? { user: { id: 'k1' } } : null }) }));
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve(m.season),
}));
vi.mock('../lib/statsTable', async (orig) => {
  const real = await orig<typeof import('../lib/statsTable')>();
  m.real = real.loadTournamentStats as never;
  return { ...real, loadTournamentStats: m.load };
});
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => m.rpc(...a),
    from: (table: string) => {
      const b = { select: () => b, eq: () => b, in: () => b, not: () => b, order: () => b, range: () => b,
        then: (resolve: (v: unknown) => void) => resolve({ data: m.tables[table] ?? [], error: null }) };
      return b;
    },
  },
}));

const stage = (id: string) => ({ id, name: `Tourney ${id}`, starts_on: '2026-01-01', ends_on: '2026-01-02', auction_run_at: 'x' });
const names = new Map([['a', 'Ari'], ['b', 'Bo']]);
const lines = [
  { session_id: 's1', athlete_id: 'a', stats: { goal: 1 } },
  { session_id: 's1', athlete_id: 'b', stats: { goal: 3 } },
];

afterEach(() => {
  cleanup();
  localStorage.clear();
});
beforeEach(() => {
  m.isKeeper = true;
  m.signedIn = true;
  m.loading = false;
  m.isAdmin = false;
  m.season = { id: 'se', name: 'Spring', settings: { stat_weights: { goal: 3, assist: 2 }, stat_lock_hours: 1 } };
  m.rpc.mockReset().mockImplementation((fn: string) => (fn === 'can_read_league_data' ? Promise.resolve({ data: true, error: null }) : undefined)); // other rpcs keep returning nothing, as before
  m.load.mockReset();
  m.load.mockResolvedValue({ stages: [stage('S2'), stage('S1')], stage: stage('S2'), games: [], lines, names, liveLines: [], liveGames: [] });
  window.location.hash = '#/stats';
});
const show = () => render(<HashRouter><StatsPage /></HashRouter>);

describe('StatsPage', () => {
  it('shows the tournament totals, best first, with the switcher', async () => {
    show();
    expect(await screen.findByRole('cell', { name: 'Bo' })).toBeTruthy();
    const rows = screen.getAllByRole('row').slice(1).map((r) => r.firstElementChild!.textContent);
    expect(rows).toEqual(['Bo', 'Ari']);
    expect((screen.getByRole('combobox', { name: 'Tournament' }) as HTMLSelectElement).value).toBe('S2');
    expect(screen.getByRole('link', { name: 'Bo' }).getAttribute('href')).toBe('#/player/b?t=S2');
  });

  it('switches tournament by reloading for the chosen one', async () => {
    show();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Tournament' }), { target: { value: 'S1' } });
    await waitFor(() => expect(m.load).toHaveBeenLastCalledWith('se', 'S1', { live: m.season!.settings }));
  });

  it('keeps the tournament switcher on screen and focused while the next one loads', async () => {
    show();
    const pick = await screen.findByRole('combobox', { name: 'Tournament' }) as HTMLSelectElement;
    pick.focus();
    m.load.mockImplementation(() => new Promise(() => {})); // the next tournament never arrives
    fireEvent.change(pick, { target: { value: 'S1' } });
    expect(await screen.findByRole('status')).toBeTruthy(); // Loading, not the old table
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Tournament' })).toBe(pick);
    expect(document.activeElement).toBe(pick);
    expect(pick.value).toBe('S1');
  });

  it('says there are no stats yet for a tournament without lines', async () => {
    m.load.mockResolvedValue({ stages: [stage('S2')], stage: stage('S2'), games: [], lines: [], names, liveLines: [], liveGames: [] });
    show();
    expect(await screen.findByText('No stats yet for Tourney S2.')).toBeTruthy();
  });

  it('says no tournaments yet, and keepers still get Tally', async () => {
    m.load.mockResolvedValue({ stages: [], stage: null, games: [], lines: [], names: new Map(), liveLines: [], liveGames: [] });
    show();
    expect(await screen.findByText('No tournaments yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tally' })).toBeTruthy();
  });

  it('gives admins Download CSV before the first tournament', async () => {
    m.isAdmin = true;
    m.load.mockResolvedValue({ stages: [], stage: null, games: [], lines: [], names: new Map(), liveLines: [], liveGames: [] });
    show();
    expect(await screen.findByText('No tournaments yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeTruthy();
  });

  it('gives a keeper the Tally button with no season at all', async () => {
    m.season = null;
    show();
    expect(await screen.findByText('No season yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tally' }).getAttribute('href')).toBe('#/tally');
  });

  it('loads the tournament named in ?t=', async () => {
    window.location.hash = '#/stats?t=S1';
    show();
    await screen.findByRole('cell', { name: 'Bo' });
    expect(m.load).toHaveBeenCalledWith('se', 'S1', { live: m.season!.settings });
  });
});

describe('StatsPage Tally link (t308)', () => {
  it('gives keepers a Tally link', async () => {
    show();
    expect((await screen.findByRole('link', { name: 'Tally' })).getAttribute('href')).toBe('#/tally');
  });

  it('gives a manager none', async () => {
    m.isKeeper = false;
    show();
    await screen.findByRole('cell', { name: 'Bo' });
    expect(screen.queryByRole('link', { name: 'Tally' })).toBeNull();
  });
});

describe('StatsPage games list (t306, t307)', () => {
  const game = (number: number, session_id: string | null, opponent: string | null, verified_at: string | null) => ({
    id: `g${number}`, stage_id: 'S2', number, session_id, started_at: session_id && 'a', finished_at: verified_at && 'b', opponent,
    label: gameName(number, opponent), verified_at,
  });
  const games = [game(1, 's1', 'Duke', '2020-01-01T00:00:00Z'), game(2, 's2', 'UNC', null), game(3, null, null, null)];
  const withGames = (g = games, l = lines) =>
    m.load.mockResolvedValue({ stages: [stage('S2')], stage: stage('S2'), games: g, lines: l, names, liveLines: [], liveGames: [] });
  const row = (text: string) => screen.getByText(text).closest('li')!;

  it("lists the tournament's games as rows with status words under the table", async () => {
    withGames();
    show();
    const first = await screen.findByRole('link', { name: /^Game 1 vs Duke/ });
    expect(first.getAttribute('href')).toBe('#/stats/s1');
    expect(first.className).toBe('row-link');
    expect(first.textContent).toContain('Final');
    const second = screen.getByRole('link', { name: /^Game 2 vs UNC/ });
    expect(second.getAttribute('href')).toBe('#/stats/s2');
    expect(second.querySelector('.live .dot')).toBeTruthy();
    expect(second.querySelector('.live')!.textContent).toBe('Live');
    expect(screen.getByText('Game 3').closest('a')).toBeNull(); // not started: nothing to open
    expect(row('Game 3').textContent).toContain('Not started');
    const heading = screen.getByRole('heading', { name: 'Games' });
    expect(screen.getByRole('table').compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('All stats')).toBeNull();
    expect(screen.queryByRole('link', { name: /^Tally Game/ })).toBeNull(); // the row is the button (rule 1)
  });

  it('explains "Finished · not verified" beside Games when no live strip does', async () => {
    withGames([games[0], { ...game(2, 's2', 'UNC', null), finished_at: 'b' }]);
    show();
    const heading = await screen.findByRole('heading', { name: 'Games' });
    expect(screen.getByRole('link', { name: /^Game 2 vs UNC/ }).textContent).toContain('Finished · not verified');
    expect(within(heading.parentElement!).getByRole('button', { name: 'What unofficial and verified mean' })).toBeTruthy();
  });

  it('leaves the Games heading bare while the live strip explains', async () => {
    m.load.mockResolvedValue({ stages: [stage('S2')], stage: stage('S2'), games: [games[0], { ...game(2, 's2', 'UNC', null), finished_at: 'b' }],
      lines, names, liveLines: [], liveGames: [2] });
    show();
    await screen.findByRole('heading', { name: 'Games' });
    expect(screen.getAllByRole('button', { name: 'What unofficial and verified mean' })).toHaveLength(1); // the strip's
    expect(document.querySelector('.strip')).toBeTruthy();
  });

  it('puts Download CSV under the games list for admins', async () => {
    m.isAdmin = true;
    withGames();
    show();
    const csv = await screen.findByRole('button', { name: 'Download CSV' });
    expect(screen.getByText('Game 3').closest('ul')!.compareDocumentPosition(csv) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives a manager no Download CSV', async () => {
    withGames();
    show();
    await screen.findByText('Game 3');
    expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  });

  it('says no stats yet while the only game is live, and still lists it', async () => {
    withGames([games[1]], []);
    show();
    expect(await screen.findByText('No stats yet for Tourney S2.')).toBeTruthy();
    expect(screen.getByRole('link', { name: /^Game 2 vs UNC/ }).getAttribute('href')).toBe('#/stats/s2');
  });

  it('shows a keeper unsaved taps on a verified game, its row opening the board (only the board can send them)', async () => {
    const SID = '00000000-0000-4000-8000-0000000000a1';
    storeQueue('k1', SID, [{} as QueuedTap, {} as QueuedTap]);
    withGames([game(1, SID, 'Duke', '2020-01-01T00:00:00Z'), game(2, 's2', null, null)]);
    show();
    await screen.findByText('Game 1 vs Duke');
    expect(row('Game 1 vs Duke').querySelector('.pill.warn')!.textContent).toBe('2 unsaved');
    expect(row('Game 1 vs Duke').querySelector('a')!.getAttribute('href')).toBe(`#/tally?game=${SID}`);
    expect(row('Game 2').textContent).not.toContain('unsaved');
    expect(row('Game 2').querySelector('a')!.getAttribute('href')).toBe('#/stats/s2');
  });
});

describe('StatsPage live numbers (t318)', () => {
  const game = (number: number, session_id: string | null, started_at: string | null, verified_at: string | null) => ({
    id: `g${number}`, stage_id: 'S2', number, session_id, started_at, finished_at: null, opponent: null, label: `Game ${number}`, verified_at,
  });
  const verified = game(1, 's1', '2020-01-01T00:00:00Z', '2020-01-01T01:00:00Z');
  const live = game(2, 's2', '2020-01-02T00:00:00Z', null);
  const withLive = (games: unknown[], l = lines, liveLines: unknown[] = [], liveGames: number[] = []) =>
    m.load.mockResolvedValue({ stages: [stage('S2')], stage: stage('S2'), games, lines: l, names, liveLines, liveGames });
  const ashTap = { session_id: 's2', athlete_id: 'a', stats: { goal: 1 } };

  const strip = () => document.querySelector<HTMLElement>('.strip');

  it('adds the live game to the table', async () => {
    withLive([verified, live], [lines[0]], [ashTap], [2]);
    show();
    const cell = await screen.findByRole('cell', { name: 'Ari' });
    expect(cell.closest('tr')!.textContent).toContain('6'); // goal 1 + 1 live = 2 goals x 3
  });

  it('reads the live strip as Live · includes game 2, not verified yet', async () => {
    withLive([verified, live], [lines[0]], [ashTap], [2]);
    show();
    await screen.findByRole('cell', { name: 'Ari' });
    expect(strip()!.querySelector('.live .dot')).toBeTruthy();
    expect(strip()!.textContent).toContain('Live · includes game 2, not verified yet');
    const help = within(strip()!).getByRole('button', { name: 'What unofficial and verified mean' });
    expect(help.nextElementSibling!.textContent).toContain('reopened for 1 hour.');
  });

  it('calls a finished, unverified game "Not verified", with no live dot', async () => {
    withLive([verified, { ...live, finished_at: '2020-01-02T02:00:00Z' }], [lines[0]], [ashTap], [2]);
    show();
    await screen.findByRole('cell', { name: 'Ari' });
    expect(strip()!.textContent).toContain('Not verified · includes game 2');
    expect(strip()!.textContent).not.toContain('Live ·');
    expect(strip()!.querySelector('.live')).toBeNull();
    expect(strip()!.querySelector('.dot')).toBeNull();
    expect(within(strip()!).getByRole('button', { name: 'What unofficial and verified mean' })).toBeTruthy();
  });

  it('names the live game as Live and the finished one as not verified when both are open', async () => {
    const done = { ...game(2, 's2', '2020-01-02T00:00:00Z', null), finished_at: '2020-01-02T02:00:00Z' };
    withLive([verified, done, game(3, 's3', '2020-01-03T00:00:00Z', null)], [lines[0]], [ashTap], [2, 3]);
    show();
    await screen.findByRole('cell', { name: 'Ari' });
    expect(strip()!.textContent).toContain('Live · includes game 3, not verified yet');
    expect(strip()!.textContent).toContain('Not verified · includes game 2');
    expect(strip()!.querySelectorAll('.live .dot')).toHaveLength(1);
  });

  it('names several live games', async () => {
    withLive([verified, live], lines, [ashTap], [3, 4]);
    show();
    await screen.findByRole('cell', { name: 'Ari' });
    expect(strip()!.textContent).toContain('Live · includes games 3 and 4, not verified yet');
  });

  it('says nothing about live numbers when no game is live', async () => {
    withLive([verified]);
    show();
    await screen.findByRole('cell', { name: 'Bo' });
    expect(strip()).toBeNull();
  });

  it('shows "No stats yet" only when there are neither verified nor live lines', async () => {
    withLive([live], [], [ashTap], [2]);
    show();
    expect(await screen.findByRole('cell', { name: 'Ari' })).toBeTruthy();
    expect(screen.queryByText(/No stats yet/)).toBeNull();
  });

  it('tells a signed-in user outside every league to join one', async () => {
    m.rpc.mockImplementation((fn: string) => Promise.resolve({ data: fn === 'can_read_league_data' ? false : null, error: null }));
    show();
    expect(await screen.findByText('Join a league to see stats.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Join a league' }).getAttribute('href')).toBe('#/leagues');
    expect(screen.queryByText('Not verified')).toBeNull();
    expect(screen.queryByText(/No stats yet/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Games' })).toBeNull();
  });

  it('never asks can_read_league_data when signed out', async () => {
    m.signedIn = false;
    show();
    expect(await screen.findByRole('cell', { name: 'Ari' })).toBeTruthy();
    expect(m.rpc).not.toHaveBeenCalledWith('can_read_league_data', expect.anything());
  });

  it('never flashes the table to a non-member whose session arrives after mount', async () => {
    m.signedIn = false;
    const view = show();
    expect(await screen.findByRole('cell', { name: 'Ari' })).toBeTruthy(); // signed out: today's page
    m.rpc.mockImplementation((fn: string) => (fn === 'can_read_league_data'
      ? new Promise((r) => setTimeout(() => r({ data: false, error: null }), 50)) : undefined));
    m.signedIn = true;
    view.rerender(<HashRouter><StatsPage /></HashRouter>);
    expect(screen.queryByRole('cell', { name: 'Ari' })).toBeNull();
    expect(screen.queryByText('Not verified')).toBeNull();
    expect(await screen.findByText('Join a league to see stats.')).toBeTruthy();
    expect(screen.queryByRole('cell', { name: 'Ari' })).toBeNull();
  });

  it('waits for auth to finish before it trusts a missing session', async () => {
    m.signedIn = false;
    m.loading = true;
    m.rpc.mockImplementation((fn: string) => (fn === 'can_read_league_data'
      ? new Promise((r) => setTimeout(() => r({ data: false, error: null }), 50)) : undefined));
    const view = show();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('cell', { name: 'Ari' })).toBeNull();
    m.signedIn = true;
    m.loading = false;
    view.rerender(<HashRouter><StatsPage /></HashRouter>);
    expect(await screen.findByText('Join a league to see stats.')).toBeTruthy();
    expect(screen.queryByRole('cell', { name: 'Ari' })).toBeNull();
  });

  it('shows the stats when the check fails', async () => {
    m.rpc.mockImplementation((fn: string) => Promise.resolve(fn === 'can_read_league_data' ? { data: null, error: { message: 'boom' } } : { data: null, error: null }));
    show();
    expect(await screen.findByRole('cell', { name: 'Ari' })).toBeTruthy();
    expect(screen.queryByText('Join a league to see stats.')).toBeNull();
  });

  it('still shows the verified lines when the live read is FORBIDDEN (athlete-only account)', async () => {
    m.tables = {
      stages: [{ id: 'S2', name: 'Tourney S2', starts_on: '2026-01-01', ends_on: '2026-01-02', auction_run_at: 'x' }],
      games: [
        { id: 'g1', stage_id: 'S2', number: 1, session_id: 's1', started_at: 'a', finished_at: 'b', opponent: null },
        { id: 'g2', stage_id: 'S2', number: 2, session_id: 's2', started_at: 'c', finished_at: null, opponent: null },
      ],
      athletes: [{ id: 'a', name: 'Ari' }, { id: 'b', name: 'Bo' }],
      sessions: [{ id: 's1', verified_at: 'v' }, { id: 's2', verified_at: null }],
      stat_lines: lines,
    };
    m.rpc.mockReset().mockResolvedValue({ data: null, error: { message: 'FORBIDDEN' } });
    m.load.mockImplementation((...a: unknown[]) => m.real!(...a));
    try {
      show();
      expect(await screen.findByRole('cell', { name: 'Bo' })).toBeTruthy();
      expect(m.rpc).toHaveBeenCalled();
      expect(document.querySelector('.strip')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      m.tables = {};
    }
  });

  describe('polling', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
    afterEach(() => vi.useRealTimers());

    it('polls while a game is live', async () => {
      withLive([verified, live], lines, [ashTap], [2]);
      show();
      await screen.findByRole('cell', { name: 'Bo' });
      expect(m.load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(15_000);
      await waitFor(() => expect(m.load).toHaveBeenCalledTimes(2));
    });

    it('does not poll when no game is live', async () => {
      withLive([verified]);
      show();
      await screen.findByRole('cell', { name: 'Bo' });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(m.load).toHaveBeenCalledTimes(1);
    });
  });
});
