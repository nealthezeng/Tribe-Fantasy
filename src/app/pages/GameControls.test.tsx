// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { api } from '../lib/rpc';
import type { GameRow } from '../lib/tournament';
import { GameControls } from './GameControls';

const state = vi.hoisted(() => ({ game: null as unknown as GameRow }));
const pairings = [{ league_id: 'L', home: 'm1', away: 'm2' }, { league_id: 'L', home: 'm3', away: null }];
const provisional = [{ league_id: 'L', order: ['m1', 'm2', 'm3'], meetings: {} }];
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadCurrentGame: () => Promise.resolve({ stage: { id: 'S1', name: 'Fall beta' }, game: state.game }),
  seasonPairings: () => Promise.resolve({
    pairings, provisional, league: new Map([['L', 'League A']]), team: new Map([['m1', 'Zeal'], ['m2', 'Flow'], ['m3', 'Money']]),
  }),
}));
vi.mock('../lib/rpc', () => ({ api: { startGame: vi.fn(), finishGame: vi.fn() } }));

const season = { id: 'se', name: 'Fall', settings: parseSettings({}) };
const upcoming: GameRow = { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null };
const live: GameRow = { ...upcoming, session_id: 'p2', started_at: '2026-11-07T16:00:00Z' };
const confirm = vi.fn();
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.startGame).mockReset().mockResolvedValue('p2');
  vi.mocked(api.finishGame).mockReset().mockResolvedValue('g3');
  confirm.mockReset().mockReturnValue(true);
  window.confirm = confirm;
});

describe('GameControls', () => {
  it('starts the next game after a confirm and opens its tally', async () => {
    state.game = upcoming;
    const onOpen = vi.fn();
    render(<GameControls season={season} onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start game 2' }));
    expect(confirm.mock.calls[0][0]).toMatch(/pick locks/);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('p2'));
    expect(api.startGame).toHaveBeenCalledWith('g2');
  });

  it('shows the next pairings before finishing, and sends them with their inputs', async () => {
    state.game = live;
    render(<GameControls season={season} sessionId="p2" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finish game 2' }));
    const panel = await screen.findByRole('group', { name: 'Finish game 2' });
    expect(panel.textContent).toContain('Zeal vs Flow · Money has a bye');
    expect(api.finishGame).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finish game 2' }).at(-1)!);
    await waitFor(() => expect(api.finishGame).toHaveBeenCalledWith('g2', pairings, provisional));
    expect(await screen.findByText('Game 2 finished. Game 3 is paired.')).toBeTruthy();
  });

  it("waits for this phone's unsaved taps before finishing", async () => {
    state.game = live;
    render(<GameControls season={season} sessionId="p2" unsaved={3} />);
    expect((await screen.findByRole('button', { name: 'Finish game 2' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("stays off another session's board", async () => {
    state.game = live;
    const { container } = render(<GameControls season={season} sessionId="practice" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });

  it('says so when another keeper started the game first', async () => {
    state.game = upcoming;
    vi.mocked(api.startGame).mockRejectedValue({ message: 'GAME_STARTED' });
    render(<GameControls season={season} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start game 2' }));
    expect(await screen.findByText('Another keeper already started this game.')).toBeTruthy();
  });

  it('can still finish a game whose session was deleted, from the session list', async () => {
    state.game = { ...live, session_id: null };
    render(<GameControls season={season} onOpen={vi.fn()} />);
    expect(await screen.findByText(/tally was deleted/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tally game 2' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Finish game 2' })).toBeTruthy();
  });
});
