// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/rpc';
import { buildLeagueTournament, type TournamentRows } from '../lib/tournament';
import { TournamentCard } from './TournamentCard';

const rows = vi.hoisted(() => ({ current: null as unknown as TournamentRows }));
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadLeagueTournament: () => Promise.resolve(buildLeagueTournament(rows.current, Date.parse('2026-11-07T16:30:00Z'))),
}));
vi.mock('../lib/rpc', () => ({ api: { setGamePick: vi.fn(), setBench: vi.fn(), swapBench: vi.fn() } }));

const NAMES: Record<string, string> = { a1: 'Ash', a2: 'Avery', a3: 'Alex', a4: 'Arlo', b1: 'Bea', b2: 'Quinn', b3: 'Blake', b4: 'Bryn' };
const roster = (m: string, ids: string[]) =>
  ids.map((athlete_id, i) => ({ stage_id: 'S1', membership_id: m, athlete_id, price: [30, 20, 10, 5][i], bench: false }));
/** Two teams before the tournament opens: a4 and b4 are the cheapest, so they're benched by default. */
const base = (): TournamentRows => ({
  settings: {},
  stages: [{ id: 'S1', name: 'Fall beta', starts_on: '2026-10-19', bid_close_at: '2026-11-03T00:00:00Z', auction_seed: null,
    auction_run_at: '2026-11-04T00:00:00Z' }],
  games: [],
  pairings: [],
  members: [{ id: 'm1', team_name: 'Zeal', created_at: '2026-10-01T00:00:00Z' }, { id: 'm2', team_name: 'Flow', created_at: '2026-10-01T00:00:00Z' }],
  slots: [...roster('m1', ['a1', 'a2', 'a3', 'a4']), ...roster('m2', ['b1', 'b2', 'b3', 'b4'])],
  picks: [],
  swaps: [],
  sessions: [],
  lines: [],
  taps: [],
  injuries: [],
  athletes: Object.entries(NAMES).map(([id, name]) => ({ id, name })),
});
/** Game 1 played (finished, stats not verified): m1 started a1, m2 b1. Game 2 is paired and not started. */
const afterGame1 = (): TournamentRows => ({
  ...base(),
  games: [{ id: 'g1', stage_id: 'S1', number: 1, session_id: 'p1', started_at: '2026-11-07T14:00:00Z', finished_at: '2026-11-07T15:00:00Z' },
    { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null }],
  pairings: [{ game_id: 'g1', home: 'm1', away: 'm2' }, { game_id: 'g2', home: 'm1', away: 'm2' }],
  // RLS: the league sees game 1's picks (started); m2's game 2 pick, if any, is sealed and never arrives.
  picks: [{ stage_id: 'S1', game_number: 1, membership_id: 'm1', athlete_id: 'a1' },
    { stage_id: 'S1', game_number: 1, membership_id: 'm2', athlete_id: 'b1' }],
  sessions: [{ id: 'p1', verified_at: null }],
});

const confirm = vi.fn();
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.setGamePick).mockReset();
  vi.mocked(api.setBench).mockReset();
  vi.mocked(api.swapBench).mockReset();
  confirm.mockReset().mockReturnValue(true);
  window.confirm = confirm;
});
const show = async (r: TournamentRows) => {
  rows.current = r;
  render(<TournamentCard membershipId="m1" leagueId="L" seasonId="se" />);
  await screen.findByRole('heading', { name: 'Tournament' });
};

describe('TournamentCard', () => {
  it('lets a manager pre-select game 1 and choose the bench before the tournament opens', async () => {
    await show(base());
    expect(screen.getByText(/Your opponent is set when the tournament opens/)).toBeTruthy();
    expect(screen.getByText('Arlo').parentElement?.textContent).toContain('Bench');
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick' })[0]); // Alex, first by name
    await waitFor(() => expect(api.setGamePick).toHaveBeenCalledWith('m1', 'S1', 1, 'a3'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Bench' })[0]);
    await waitFor(() => expect(api.setBench).toHaveBeenCalledWith('m1', 'S1', ['a3']));
  });

  it("shows the next opponent, the tiredness of last game's starter, and never the opponent's sealed pick", async () => {
    await show(afterGame1());
    expect(screen.getByRole('heading', { name: 'Game 2 · Fall beta' })).toBeTruthy();
    expect(screen.getByText(/Their pick stays hidden until the game starts/).textContent).toContain('Flow');
    expect(screen.getByText('Ash').parentElement?.textContent).toContain('Tired ×0.5');
    // Quinn is who the scorer would auto-pick for Flow: shown nowhere until game 2 starts.
    expect(document.body.textContent).not.toContain('Quinn');
    expect(screen.getByText(/Waiting on stats/)).toBeTruthy(); // game 1, finished but not verified
    expect(screen.queryByRole('button', { name: 'Bench' })).toBeNull(); // the tournament has started
  });

  it('offers the bench swap for an injured active player once the tournament has started', async () => {
    await show({ ...afterGame1(), injuries: [{ athlete_id: 'a2', confirmed_at: '2026-11-07T14:30:00Z', cleared_at: null }] });
    fireEvent.click(screen.getByRole('button', { name: 'Swap in for Avery' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.swapBench).toHaveBeenCalledWith('m1', 'S1', 'a2', 'a4'));
  });

  it('marks a game whose tally was deleted as void', async () => {
    const r = afterGame1();
    await show({ ...r, games: r.games.map((g) => (g.id === 'g1' ? { ...g, session_id: null } : g)), sessions: [] });
    fireEvent.click(screen.getByText(/Game 1 · Fall beta/));
    expect(screen.getByText('Void')).toBeTruthy();
    expect(screen.getByText(/tally was deleted/)).toBeTruthy();
    // A void start doesn't tire anyone.
    expect(screen.getByText('Ash').parentElement?.textContent).not.toContain('Tired');
  });
});
