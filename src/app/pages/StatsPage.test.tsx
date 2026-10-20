// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HashRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsPage } from './StatsPage';

const m = vi.hoisted(() => ({
  isKeeper: true,
  season: { id: 'se', name: 'Spring', settings: { stat_weights: { goal: 3, assist: 2 } } } as { id: string; name: string; settings: unknown } | null,
  load: vi.fn(),
}));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: false, isKeeper: m.isKeeper }) }));
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

afterEach(cleanup);
beforeEach(() => {
  m.isKeeper = true;
  m.season = { id: 'se', name: 'Spring', settings: { stat_weights: { goal: 3, assist: 2 } } };
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
