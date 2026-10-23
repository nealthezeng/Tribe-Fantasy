// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { api } from '../lib/rpc';
import type { GameRow } from '../lib/tournament';
import { GameControls } from './GameControls';

const state = vi.hoisted(() => ({
  game: null as unknown as GameRow, games: null as GameRow[] | null, sessions: [] as { id: string; verified_at: string | null }[],
}));
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
vi.mock('../lib/supabase', () => ({ // the list's status words read each game session's verified_at
  supabase: { from: () => ({ select: () => ({ in: () => Promise.resolve({ data: state.sessions, error: null }) }) }) },
}));

const season = { id: 'se', name: 'Fall', settings: parseSettings({}) };
const upcoming: GameRow = { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null, opponent: null };
const live: GameRow = { ...upcoming, session_id: 'p2', started_at: '2026-11-07T16:00:00Z' };
const last: GameRow = { ...live, finished_at: '2026-11-07T17:00:00Z' }; // the last game, finished: the tournament is over
const confirm = vi.fn();
const T = '2026-11-07T16:00:00Z';
const view = (ui: ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.startGame).mockReset().mockResolvedValue('p2');
  vi.mocked(api.finishGame).mockReset().mockResolvedValue('g3');
  vi.mocked(api.setGameOpponent).mockReset().mockResolvedValue(undefined);
  state.games = null;
  state.sessions = [];
  confirm.mockReset().mockReturnValue(true);
  window.confirm = confirm;
});

describe('GameControls', () => {
  it('starts the next game after a confirm and opens its tally', async () => {
    state.game = upcoming;
    const onOpen = vi.fn();
    view(<GameControls season={season} onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start game 2' }));
    expect(confirm.mock.calls[0][0]).toMatch(/picks for it lock now/);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('p2'));
    expect(api.startGame).toHaveBeenCalledWith('g2');
  });

  it('shows the next pairings before finishing, and sends them with their inputs', async () => {
    state.games = [{ ...upcoming, id: 'g1', number: 1, started_at: '2026-11-07T15:00:00Z', finished_at: '2026-11-07T16:00:00Z' }, live, { ...upcoming, id: 'g3', number: 3 }];
    view(<GameControls season={season} sessionId="p2" />);
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
    view(<GameControls season={season} sessionId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finish game 1' }));
    const panel = await screen.findByRole('group', { name: 'Finish game 1' });
    expect(panel.textContent).toContain('Game 2 pairings');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks "Finish game 1 vs Pitt? Game 2 gets paired; an admin can undo it." with the pairings in a fold', async () => {
    state.games = [game(1, { session_id: 'p1', started_at: '2026-11-07T16:00:00Z', opponent: 'Pitt' }), game(2), game(3)];
    view(<GameControls season={season} sessionId="p1" />);
    const finish = await screen.findByRole('button', { name: 'Finish game 1' });
    expect(finish.className).toBe('secondary'); // a quiet button at the end of the board
    fireEvent.click(finish);
    const panel = await screen.findByRole('group', { name: 'Finish game 1' });
    expect(panel.querySelector('p')!.textContent).toBe('Finish game 1 vs Pitt? Game 2 gets paired; an admin can undo it.');
    const fold = panel.querySelector('details')!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary')!.textContent).toBe('Game 2 pairings');
    expect(fold.textContent).toContain('Zeal vs Flow · Money has a bye');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('finishing the last game confirms and sends no pairings', async () => {
    state.games = [game(1, { started_at: '2026-11-07T15:00:00Z', finished_at: '2026-11-07T16:00:00Z' }), game(2, { session_id: 'p2', started_at: '2026-11-07T16:00:00Z' })];
    view(<GameControls season={season} sessionId="p2" />);
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
    view(<GameControls season={season} sessionId="p2" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Finish game 2' }));
    await screen.findByRole('group', { name: 'Finish game 2' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Finish game 2' }).at(-1)!);
    expect(await screen.findByText('Game 2 finished. Fall beta is over.')).toBeTruthy();
    expect(screen.queryByText(/is paired/)).toBeNull();
  });

  it('says over with no button after the last game', async () => {
    state.game = last;
    view(<GameControls season={season} onOpen={vi.fn()} />);
    expect(await screen.findByText('Fall beta is over after game 2.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Start game|Add game|Finish game/ })).toBeNull();
  });

  it('has no "That was the last game" button', async () => {
    state.game = live;
    view(<GameControls season={season} sessionId="p2" />);
    await screen.findByRole('button', { name: 'Finish game 2' });
    expect(screen.queryByRole('button', { name: 'That was the last game' })).toBeNull();
    expect(screen.queryByRole('list')).toBeNull(); // the board shows only Finish: no game rows, no opponents
    expect(screen.queryByText('Opponents')).toBeNull();
  });

  it('saves changed opponents with one Save', async () => {
    state.games = [game(1, { opponent: 'Pitt' }), game(2), game(3)];
    view(<GameControls season={season} onOpen={vi.fn()} />);
    const g3 = await screen.findByLabelText('Game 3');
    expect((screen.getByLabelText('Game 1') as HTMLInputElement).value).toBe('Pitt');
    expect(g3.getAttribute('placeholder')).toBe('Opponent');
    const save = screen.getByRole('button', { name: 'Save opponents' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing changed yet
    fireEvent.change(screen.getByLabelText('Game 1'), { target: { value: 'Pitt State' } });
    fireEvent.change(g3, { target: { value: 'Duke' } });
    expect(screen.getAllByRole('button', { name: /Save/ })).toEqual([save]);
    fireEvent.click(save);
    await waitFor(() => expect(api.setGameOpponent).toHaveBeenCalledTimes(2));
    expect(api.setGameOpponent).toHaveBeenCalledWith('g1', 'Pitt State');
    expect(api.setGameOpponent).toHaveBeenCalledWith('g3', 'Duke');
  });

  it('makes Tally the one gold button while a game is live, with no Finish on the list', async () => {
    state.games = [game(1, { session_id: 'p1', started_at: T, finished_at: T }), live, game(3)];
    state.sessions = [{ id: 'p1', verified_at: T }, { id: 'p2', verified_at: null }];
    const { container } = view(<GameControls season={season} onOpen={vi.fn()} unsaved={new Map([['p2', 2]])} />);
    const tally = await screen.findByRole('link', { name: 'Tally game 2' });
    expect(tally.getAttribute('href')).toBe('/tally?game=p2');
    expect([...container.querySelectorAll('button:not(.secondary), .button')]).toEqual([tally]);
    expect(screen.queryByRole('button', { name: /Finish/ })).toBeNull();
    expect(container.querySelector('.strip')!.textContent).toBe('Fall beta · Game 2Live');
  });

  it('lists every game with its status and a To verify link for a finished unverified game', async () => {
    state.games = [
      game(1, { session_id: 'p1', started_at: T, finished_at: T, opponent: 'Pitt' }),
      game(2, { session_id: 'p2', started_at: T, finished_at: T }),
      game(3, { session_id: 'p3', started_at: T }),
      game(4),
      game(5, { started_at: T, finished_at: T }), // its tally was deleted
    ];
    state.sessions = [{ id: 'p1', verified_at: T }, { id: 'p2', verified_at: null }, { id: 'p3', verified_at: null }];
    const { container } = view(<GameControls season={season} onOpen={vi.fn()} />);
    const verify = await screen.findByText('To verify');
    expect(verify.className).toBe('pill warn');
    expect(verify.closest('a')!.getAttribute('href')).toBe('/stats/p2');
    const rows = [...container.querySelectorAll('.list .row-link')];
    expect(rows.map((r) => r.textContent)).toEqual([
      'Game 1 vs PittFinal', 'Game 2Finished · not verifiedTo verify', 'Game 3Live', 'Game 4Not started', "Game 5Doesn't count",
    ]);
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(['/stats/p1', '/stats/p2', '/tally?game=p3', null, null]);
    expect(rows.slice(3).map((r) => r.tagName)).toEqual(['DIV', 'DIV']); // nothing to open: no link, no chevron
  });

  it('opens the board, not the stats, of a game with taps still on this phone', async () => {
    state.games = [game(1, { session_id: 'p1', started_at: T, finished_at: T }), game(2)];
    view(<GameControls season={season} onOpen={vi.fn()} unsaved={new Map([['p1', 3]])} />);
    const row = (await screen.findByText('3 unsaved')).closest('a')!;
    expect(row.getAttribute('href')).toBe('/tally?game=p1');
    expect(row.textContent).toBe('Game 1Finished · not verified3 unsaved');
  });

  it('asks "Start game 2 vs UNC? Every team\'s picks for it lock now."', async () => {
    state.game = { ...upcoming, opponent: 'UNC' };
    view(<GameControls season={season} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start game 2' }));
    expect(confirm).toHaveBeenCalledWith("Start game 2 vs UNC? Every team's picks for it lock now.");
  });

  it("waits for this phone's unsaved taps before finishing", async () => {
    state.game = live;
    view(<GameControls season={season} sessionId="p2" unsaved={new Map([['p2', 3]])} />);
    expect((await screen.findByRole('button', { name: 'Finish game 2' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("stays off another session's board", async () => {
    state.game = live;
    const { container } = view(<GameControls season={season} sessionId="practice" />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });

  it('says so when another keeper started the game first', async () => {
    state.game = upcoming;
    vi.mocked(api.startGame).mockRejectedValue({ message: 'GAME_STARTED' });
    view(<GameControls season={season} onOpen={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start game 2' }));
    expect(await screen.findByText('Another keeper already started this game.')).toBeTruthy();
  });

  it('can still finish a game whose session was deleted, from the session list', async () => {
    state.game = { ...live, session_id: null };
    view(<GameControls season={season} onOpen={vi.fn()} />);
    expect(await screen.findByText(/tally was deleted/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tally game 2' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Finish game 2' })).toBeTruthy();
  });

  it('names the game after the real opponent and shows it in place of the bare number (t123)', async () => {
    state.game = upcoming;
    vi.mocked(api.setGameOpponent).mockReset().mockImplementation(async () => { state.game = { ...upcoming, opponent: 'Duke' }; });
    view(<GameControls season={season} onOpen={vi.fn()} />);
    fireEvent.change(await screen.findByLabelText('Game 2'), { target: { value: 'Duke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save opponents' }));
    await waitFor(() => expect(api.setGameOpponent).toHaveBeenCalledWith('g2', 'Duke'));
    expect(await screen.findByText('Fall beta · Game 2 vs Duke')).toBeTruthy();
    expect((screen.getByLabelText('Game 2') as HTMLInputElement).value).toBe('Duke');
    expect((screen.getByRole('button', { name: 'Save opponents' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
