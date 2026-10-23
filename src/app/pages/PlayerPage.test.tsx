// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HashRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerPage } from './PlayerPage';

const m = vi.hoisted(() => ({ load: vi.fn(), settings: { stat_weights: { goal: 3, assist: 2 } } }));
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve({ id: 'se', name: 'Spring', settings: m.settings }),
}));
vi.mock('../lib/statsTable', async (orig) => ({ ...(await orig<typeof import('../lib/statsTable')>()), loadTournamentStats: m.load }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));

const stage = (id: string) => ({ id, name: `Tourney ${id}`, starts_on: '2026-01-01', ends_on: '2026-01-02', auction_run_at: 'x' });
const game = (number: number, label: string, verified_at: string | null) =>
  ({ id: `g${number}`, number, label, verified_at, session_id: `s${number}` });

afterEach(cleanup);
beforeEach(() => {
  m.load.mockReset();
  m.load.mockResolvedValue({
    stages: [stage('S2'), stage('S1')], stage: stage('S1'),
    games: [game(1, 'vs Duke', 'v'), game(2, 'Game 2', 'v'), game(3, 'Game 3', null)],
    lines: [{ session_id: 's1', athlete_id: 'a', stats: { goal: 2 } }, { session_id: 's2', athlete_id: 'b', stats: { goal: 1 } }],
    names: new Map([['a', 'Ari'], ['b', 'Bo']]),
    liveLines: [], liveGames: [],
  });
});
const show = (hash: string) => {
  window.location.hash = hash;
  render(<HashRouter><Routes><Route path="/player/:athleteId" element={<PlayerPage />} /></Routes></HashRouter>);
};
const rowTexts = () => screen.getAllByRole('row').slice(1).map((r) => [...r.children].map((c) => c.textContent));

describe('PlayerPage', () => {
  it('lists the player game by game, verified games only, zeros where no line', async () => {
    show('#/player/a?t=S1');
    expect(await screen.findByRole('heading', { name: /Ari/ })).toBeTruthy();
    expect(rowTexts()).toEqual([['vs Duke', '2', '0', '6'], ['Game 2', '0', '0', '0'], ['Total', '2', '0', '6']]);
    expect(screen.queryByText('Game 3')).toBeNull();
    expect(m.load).toHaveBeenCalledWith('se', 'S1', { live: m.settings });
    expect(screen.getByRole('link', { name: /Stats/ }).getAttribute('href')).toBe('#/stats?t=S1');
    expect(screen.getByRole('combobox', { name: 'Tournament' })).toBeTruthy();
  });

  it('shows loading, not the old tournament, while the picked one loads', async () => {
    show('#/player/a?t=S1');
    const pick = await screen.findByRole('combobox', { name: 'Tournament' });
    m.load.mockImplementation(() => new Promise(() => {}));
    fireEvent.change(pick, { target: { value: 'S2' } });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Tournament' })).toBeNull();
  });

  it('says no tournaments yet (not "not in this season") before any tournament', async () => {
    m.load.mockResolvedValue({ stages: [], stage: null, games: [], lines: [], names: new Map(), liveLines: [], liveGames: [] });
    show('#/player/a');
    expect(await screen.findByText('No tournaments yet.')).toBeTruthy();
    expect(screen.queryByText(/isn't in this season/)).toBeNull();
  });

  it('adds a Total row and the live game as "live, not counted yet"', async () => {
    m.load.mockResolvedValue({
      stages: [stage('S1')], stage: stage('S1'),
      games: [game(1, 'Game 1 vs Duke', 'v'), game(2, 'Game 2', 'v'), game(3, 'Game 3 vs UNC', null), game(4, 'Game 4', null)],
      lines: [{ session_id: 's1', athlete_id: 'a', stats: { goal: 2 } }, { session_id: 's2', athlete_id: 'a', stats: { goal: 1, assist: 1 } }],
      names: new Map([['a', 'Ari']]),
      liveLines: [{ session_id: 's3', athlete_id: 'a', stats: { assist: 2 } }], liveGames: [3],
    });
    show('#/player/a?t=S1');
    await screen.findByRole('heading', { name: /Ari/ });
    expect(rowTexts()).toEqual([
      ['Game 1 vs Duke', '2', '0', '6'],
      ['Game 2', '1', '1', '5'],
      ['Game 3 vs UNC · live, not counted yet', '0', '2', '4'],
      ['Total', '3', '1', '11'], // verified games only
    ]);
    expect(screen.queryByText(/Game 4/)).toBeNull(); // not started
  });

  it("says the player is not in this season for an unknown id", async () => {
    show('#/player/zzz');
    expect(await screen.findByText(/isn't in this season/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Stats/ })).toBeTruthy();
  });
});
