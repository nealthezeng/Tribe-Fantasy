// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storeQueue, type QueuedTap } from '../tally/queue';
import { StatsPage } from './StatsPage';

const m = vi.hoisted(() => ({
  isKeeper: true,
  isAdmin: false,
  season: { id: 'se', name: 'Spring', settings: { stat_weights: { goal: 3, assist: 2 }, stat_lock_hours: 1 } } as { id: string; name: string; settings: unknown } | null,
  load: vi.fn(),
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: m.isAdmin, isKeeper: m.isKeeper, session: { user: { id: 'k1' } } }) }));
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve(m.season),
}));
vi.mock('../lib/statsTable', async (orig) => ({ ...(await orig<typeof import('../lib/statsTable')>()), loadTournamentStats: m.load }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

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
  m.isAdmin = false;
  m.season = { id: 'se', name: 'Spring', settings: { stat_weights: { goal: 3, assist: 2 }, stat_lock_hours: 1 } };
  m.load.mockReset();
  m.load.mockResolvedValue({ stages: [stage('S2'), stage('S1')], stage: stage('S2'), games: [], lines, names });
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
    await waitFor(() => expect(m.load).toHaveBeenLastCalledWith('se', 'S1'));
  });

  it('shows the loading state, not the old table, while the picked tournament loads', async () => {
    show();
    const pick = await screen.findByRole('combobox', { name: 'Tournament' });
    m.load.mockImplementation(() => new Promise(() => {})); // the next tournament never arrives
    fireEvent.change(pick, { target: { value: 'S1' } });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Tournament' })).toBeNull();
  });

  it('says there are no stats yet for a tournament without lines', async () => {
    m.load.mockResolvedValue({ stages: [stage('S2')], stage: stage('S2'), games: [], lines: [], names });
    show();
    expect(await screen.findByText('No stats yet for Tourney S2.')).toBeTruthy();
  });

  it('says no tournaments yet, and keepers still get Tally', async () => {
    m.load.mockResolvedValue({ stages: [], stage: null, games: [], lines: [], names: new Map() });
    show();
    expect(await screen.findByText('No tournaments yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tally' })).toBeTruthy();
  });

  it('gives admins Download CSV before the first tournament', async () => {
    m.isAdmin = true;
    m.load.mockResolvedValue({ stages: [], stage: null, games: [], lines: [], names: new Map() });
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
    expect(m.load).toHaveBeenCalledWith('se', 'S1');
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

describe('StatsPage All stats fold (t306, t307)', () => {
  const game = (number: number, session_id: string | null, opponent: string | null, verified_at: string | null) => ({
    id: `g${number}`, stage_id: 'S2', number, session_id, started_at: null, finished_at: null, opponent,
    label: opponent ? `vs ${opponent}` : `Game ${number}`, verified_at,
  });
  const games = [game(1, 's1', 'Duke', '2020-01-01T00:00:00Z'), game(2, 's2', null, null), game(3, null, null, null)];
  const withGames = (g = games, l = lines) =>
    m.load.mockResolvedValue({ stages: [stage('S2')], stage: stage('S2'), games: g, lines: l, names });
  const fold = () => screen.getByText('All stats').closest('details')!;

  it('lists the tournament games under All stats, each opening its game page', async () => {
    withGames();
    show();
    expect((await screen.findByRole('link', { name: 'Game 1 vs Duke' })).getAttribute('href')).toBe('#/stats/s1');
    expect(screen.getByRole('link', { name: 'Game 2' }).getAttribute('href')).toBe('#/stats/s2');
    expect(screen.getByText('Game 3').closest('li')!.textContent).toContain('Not started');
    expect(screen.getByText('Game 1 vs Duke').closest('li')!.textContent).toContain('Locked');
  });

  it('gives keepers a Tally button on open games only, with the fold open', async () => {
    withGames();
    show();
    expect((await screen.findByRole('link', { name: 'Tally Game 2' })).getAttribute('href')).toBe('#/tally?game=s2');
    expect(screen.queryByRole('link', { name: 'Tally Game 1 vs Duke' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tally Game 3' })).toBeNull();
    expect(fold().open).toBe(true);
  });

  it('leaves the fold closed when nothing is open to tally', async () => {
    withGames([games[0], games[2]]);
    show();
    await screen.findByText('All stats');
    expect(fold().open).toBe(false);
  });

  it('shows a manager no Tally buttons, and the fold closed', async () => {
    m.isKeeper = false;
    withGames();
    show();
    await screen.findByText('All stats');
    expect(screen.queryByRole('link', { name: /^Tally/ })).toBeNull();
    expect(fold().open).toBe(false);
  });

  it('keeps Download CSV for admins inside All stats', async () => {
    m.isAdmin = true;
    withGames();
    show();
    const csv = await screen.findByRole('button', { name: 'Download CSV' });
    expect(fold().contains(csv)).toBe(true);
  });

  it('says no stats yet while the only game is live, and still offers Tally', async () => {
    withGames([games[1]], []);
    show();
    expect(await screen.findByText('No stats yet for Tourney S2.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Tally Game 2' })).toBeTruthy();
  });

  it('shows a keeper unsaved taps on a verified game, with a way to open it', async () => {
    const SID = '00000000-0000-4000-8000-0000000000a1';
    storeQueue('k1', SID, [{} as QueuedTap, {} as QueuedTap]);
    withGames([game(1, SID, 'Duke', '2020-01-01T00:00:00Z'), game(2, 's2', null, null)]);
    show();
    const row = (await screen.findByText('Game 1 vs Duke')).closest('li')!;
    expect(row.textContent).toContain('2 unsaved');
    expect(screen.getByRole('link', { name: 'Open Game 1 vs Duke' }).getAttribute('href')).toBe(`#/tally?game=${SID}`);
    expect(screen.getByText('Game 2').closest('li')!.textContent).not.toContain('unsaved');
  });
});
