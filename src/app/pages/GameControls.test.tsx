// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { api } from '../lib/rpc';
import type { GameRow } from '../lib/tournament';
import { GameControls } from './GameControls';

const state = vi.hoisted(() => ({ game: null as unknown as GameRow, games: null as GameRow[] | null }));
const pairings = [{ league_id: 'L', home: 'm1', away: 'm2' }, { league_id: 'L', home: 'm3', away: null }];
const provisional = [{ league_id: 'L', order: ['m1', 'm2', 'm3'], meetings: {} }];
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  // state.games = a whole tournament (current = first unfinished, else last); otherwise just state.game as a 2-game one.
  loadCurrentGame: () => {
    const games = state.games ?? [state.game];
    const game = games.find((x) => x.finished_at === null) ?? games.at(-1)!;
    return Promise.resolve({ stage: { id: 'S1', name: 'Fall beta' }, game, games, count: state.games ? games.length : 2 });
  },
  seasonPairings: () => Promise.resolve({
    pairings, provisional, league: new Map([['L', 'League A']]), team: new Map([['m1', 'Zeal'], ['m2', 'Flow'], ['m3', 'Money']]),
  }),
}));
vi.mock('../lib/rpc', () => ({
  api: { startGame: vi.fn(), finishGame: vi.fn(), setGameOpponent: vi.fn() },
}));

const season = { id: 'se', name: 'Fall', settings: parseSettings({}) };
const upcoming: GameRow = { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null, opponent: null };
const live: GameRow = { ...upcoming, session_id: 'p2', started_at: '2026-11-07T16:00:00Z' };
const last: GameRow = { ...live, finished_at: '2026-11-07T17:00:00Z' }; // the last game, finished: the tournament is over
const confirm = vi.fn();
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.startGame).mockReset().mockResolvedValue('p2');
  vi.mocked(api.finishGame).mockReset().mockResolvedValue('g3');
  state.games = null;
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
    state.games = [{ ...upcoming, id: 'g1', number: 1, started_at: '2026-11-07T15:00:00Z', finished_at: '2026-11-07T16:00:00Z' }, live, { ...upcoming, id: 'g3', number: 3 }];
    render(<GameControls season={season} sessionId="p2" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finish game 2' }));
    const panel = await screen.findByRole('group', { name: 'Finish game 2' });
    expect(panel.textContent).toContain('Zeal vs Flow · Money has a bye');
    expect(api.finishGame).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finish game 2' }).at(-1)!);
    await waitFor(() => expect(api.finishGame).toHaveBeenCalledWith('g2', pairings, provisional));
    expect(await screen.findByText('Game 2 finished. Game 3 is paired.')).toBeTruthy();
  });

  const game = (n: number, over: Partial<GameRow> = {}): GameRow => ({ ...upcoming, id: `g${n}`, number: n, ...over });

  it('finishing a non-last game previews the next pairings', async () => {
    state.games = [game(1, { session_id: 'p1', started_at: '2026-11-07T16:00:00Z' }), game(2), game(3)];
    render(<GameControls season={season} sessionId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finish game 1' }));
    const panel = await screen.findByRole('group', { name: 'Finish game 1' });
    expect(panel.textContent).toContain('Game 2 pairings');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('finishing the last game confirms and sends no pairings', async () => {
    state.games = [game(1, { started_at: '2026-11-07T15:00:00Z', finished_at: '2026-11-07T16:00:00Z' }), game(2, { session_id: 'p2', started_at: '2026-11-07T16:00:00Z' })];
    render(<GameControls season={season} sessionId="p2" />);
    vi.mocked(api.finishGame).mockResolvedValue(null); // the server pairs nothing after the last game
    confirm.mockReturnValueOnce(false);
    const finish = await screen.findByRole('button', { name: 'Finish game 2' });
    fireEvent.click(finish);
    expect(api.finishGame).not.toHaveBeenCalled();
    fireEvent.click(finish);
    expect(confirm.mock.calls[1][0]).toMatch(/Finish game 2\? It's the last game: Fall beta ends\./);
    await waitFor(() => expect(api.finishGame).toHaveBeenCalledWith('g2', [], []));
    expect(await screen.findByText('Game 2 finished. Fall beta is over.')).toBeTruthy();
  });

  it('says the tournament is over when a confirmed finish pairs nothing', async () => {
    state.games = [game(1, { started_at: '2026-11-07T15:00:00Z', finished_at: '2026-11-07T16:00:00Z' }), game(2, { session_id: 'p2', started_at: '2026-11-07T16:00:00Z' }), game(3)];
    vi.mocked(api.finishGame).mockResolvedValue(null); // the count was lowered meanwhile: game 3 is gone
    render(<GameControls season={season} sessionId="p2" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finish game 2' }));
    await screen.findByRole('group', { name: 'Finish game 2' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Finish game 2' }).at(-1)!);
    expect(await screen.findByText('Game 2 finished. Fall beta is over.')).toBeTruthy();
    expect(screen.queryByText(/is paired/)).toBeNull();
  });

  it('says over with no button after the last game', async () => {
    state.game = last;
    render(<GameControls season={season} onOpen={vi.fn()} />);
    expect(await screen.findByText('Fall beta is over after game 2.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Start game|Add game|Finish game/ })).toBeNull();
  });

  it('has no "That was the last game" button', async () => {
    state.game = live;
    render(<GameControls season={season} sessionId="p2" />);
    await screen.findByRole('button', { name: 'Finish game 2' });
    expect(screen.queryByRole('button', { name: 'That was the last game' })).toBeNull();
  });

  it('lists every game for opponents and saves one', async () => {
    state.games = [game(1, { opponent: 'Pitt' }), game(2), game(3)];
    render(<GameControls season={season} onOpen={vi.fn()} />);
    const g3 = await screen.findByLabelText('Game 3');
    expect((screen.getByLabelText('Game 1') as HTMLInputElement).value).toBe('Pitt');
    fireEvent.change(screen.getByLabelText('Game 1'), { target: { value: 'Pitt!' } });
    fireEvent.change(g3, { target: { value: 'Duke' } });
    const saves = screen.getAllByRole('button', { name: 'Save' }) as HTMLButtonElement[];
    expect(saves.map((b) => b.disabled)).toEqual([false, true, false]);
    fireEvent.click(saves[2]);
    await waitFor(() => expect(api.setGameOpponent).toHaveBeenCalledWith('g3', 'Duke'));
    expect((screen.getByLabelText('Game 1') as HTMLInputElement).value).toBe('Pitt!'); // game 1's draft is untouched
  });

  it("waits for this phone's unsaved taps before finishing", async () => {
    state.game = live;
    render(<GameControls season={season} sessionId="p2" unsaved={new Map([['p2', 3]])} />);
    expect((await screen.findByRole('button', { name: 'Finish game 2' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables Finish on the session list when this phone has unsaved taps for the live game', async () => {
    state.game = live;
    const onOpen = vi.fn();
    render(<GameControls season={season} onOpen={onOpen} unsaved={new Map([['p2', 2]])} />);
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

  it('names the game after the real opponent and shows it in place of the bare number (t123)', async () => {
    state.game = upcoming;
    vi.mocked(api.setGameOpponent).mockReset().mockImplementation(async () => { state.game = { ...upcoming, opponent: 'Duke' }; });
    render(<GameControls season={season} onOpen={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Game 2'), { target: { value: 'Duke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.setGameOpponent).toHaveBeenCalledWith('g2', 'Duke'));
    expect(await screen.findByText(/Game 2 vs Duke is next/)).toBeTruthy();
    expect((screen.getByLabelText('Game 2') as HTMLInputElement).value).toBe('Duke');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
