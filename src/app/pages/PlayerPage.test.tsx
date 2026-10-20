// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { HashRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerPage } from './PlayerPage';

const m = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve({ id: 'se', name: 'Spring', settings: { stat_weights: { goal: 3, assist: 2 } } }),
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
    expect(rowTexts()).toEqual([['vs Duke', '2', '0', '6'], ['Game 2', '0', '0', '0']]);
    expect(screen.queryByText('Game 3')).toBeNull();
    expect(m.load).toHaveBeenCalledWith('se', 'S1');
    expect(screen.getByRole('link', { name: /Stats/ }).getAttribute('href')).toBe('#/stats?t=S1');
    expect(screen.getByRole('combobox', { name: 'Tournament' })).toBeTruthy();
  });

  it("says the player is not in this season for an unknown id", async () => {
    show('#/player/zzz');
    expect(await screen.findByText(/isn't in this season/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Stats/ })).toBeTruthy();
  });
});
