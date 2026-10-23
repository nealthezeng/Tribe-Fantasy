// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { api } from '../lib/rpc';
import { storeQueue, type QueuedTap } from '../tally/queue';
import { STARTERS_WAIT_MS, TallyPage } from './TallyPage';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'k1' } }, isAdmin: false, isKeeper: true, loading: false }),
}));
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve({ id: 'se', name: 'Fall', settings: parseSettings({}) }),
}));
// On a board it stands for the live game's Finish section.
vi.mock('./GameControls', () => ({
  GameControls: ({ sessionId }: { sessionId?: string }) => (sessionId ? <button className="secondary">Finish game 2</button> : null),
}));
vi.mock('./OutList', () => ({ OutList: () => <p>Out list</p> }));
vi.mock('../lib/rpc', () => ({ api: { setOut: vi.fn(), clearOut: vi.fn() } }));

const gone = vi.hoisted(() => ({
  on: false, outs: [] as { athlete_id: string; from_game: number }[], owned: false, games: null as unknown[] | null,
  sessions: null as unknown[] | null, current: null as unknown, // current = the hub's tournament (loadCurrentGame)
  athletes: null as { id: string; name: string }[] | null, starters: [] as string[] | null, // null = the starters fail to load
  late: null as Promise<Set<string>> | null, // starters that land when the test says
}));
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadCurrentGame: () => Promise.resolve(gone.current),
  loadStarters: () => gone.late ?? (gone.starters ? Promise.resolve(new Set(gone.starters)) : Promise.reject(new Error('offline'))),
}));
const DRILL = '00000000-0000-4000-8000-00000000d111';
const session = (id: string, kind: string) => ({
  id, season_id: 'se', kind, held_on: '2026-11-07', counts: true, created_by: 'k1', verified_by: null, verified_at: null,
});
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === 'sessions' ? gone.sessions ?? [session('game', 'tournament'), session(DRILL, 'practice')]
        : table === 'games' ? gone.games ?? [{ session_id: 'game', stage_id: 's1', number: 2 }]
        : table === 'athletes' ? gone.athletes ?? [{ id: 'a0', name: 'A0' }, { id: 'a1', name: 'A1' }]
        : table === 'outs' ? gone.outs : table === 'roster_slots' ? (gone.owned ? [{ athlete_id: 'a0' }] : [])
        : table === 'stages' ? [{ id: 's1', starts_on: '2000-01-01', ends_on: '2099-01-01' }] : [];
      const builder = {
        single: () => Promise.resolve(gone.on ? { data: null, error: { message: 'Row not found' } } : { data: rows[0], error: null }),
        maybeSingle: () => Promise.resolve({ data: rows[0], error: null }), not: () => builder,
        select: () => builder, is: () => builder, or: () => builder, order: () => builder, in: () => builder, eq: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  },
}));

beforeEach(() => {
  vi.mocked(api.setOut).mockReset().mockResolvedValue(3);
  vi.mocked(api.clearOut).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  gone.on = false;
  gone.outs = [];
  gone.owned = false;
  gone.games = null;
  gone.sessions = null;
  gone.current = null;
  gone.athletes = null;
  gone.starters = [];
  gone.late = null;
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.tally;
});

describe('TallyPage session list', () => {
  it('lists open tournament games only, with no way to start or delete a practice session (T4)', async () => {
    render(<MemoryRouter><TallyPage /></MemoryRouter>);
    const game = (await screen.findByText(/^Game 2 ·/)).closest('li')!;
    expect(game.textContent).not.toContain('Delete');
    expect(screen.queryByText('Sat, Nov 7 · Practice')).toBeNull();
    expect(screen.queryByText('New session')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByText('Out list')).toBeTruthy(); // the Players out card sits on the list
  });

  it("lists only other tournaments' open games under Open games, titled with gameTitles, as rows", async () => {
    const live = '00000000-0000-4000-8000-00000000a222'; // the current tournament's live game
    gone.sessions = [session(live, 'tournament'), session('old', 'tournament')];
    gone.games = [
      { session_id: live, stage_id: 's1', number: 2, opponent: 'UNC', stages: { name: 'CCCs' } },
      { session_id: 'old', stage_id: 's0', number: 4, opponent: 'Duke', stages: { name: 'Warmup' } },
    ];
    gone.current = { stage: { id: 's1', name: 'CCCs' }, games: [{ id: 'g2', session_id: live }, { id: 'g3', session_id: null }] };
    storeQueue('k1', live, [{} as QueuedTap]); // its unsaved pill sits on its own row there too
    render(<MemoryRouter><TallyPage /></MemoryRouter>);
    const card = (await screen.findByText('Open games')).closest('.card')!;
    const rows = [...card.querySelectorAll('.row-link')];
    expect(rows.map((r) => r.textContent)).toEqual(['Game 4 vs Duke · Warmup']); // CCCs' games are on its own card
    expect(rows[0].getAttribute('href')).toBe('/tally?game=old');
  });

  it('hides Open games when no other tournament has one', async () => {
    gone.current = { stage: { id: 's1', name: 'CCCs' }, games: [{ id: 'g2', session_id: 'game' }] };
    render(<MemoryRouter><TallyPage /></MemoryRouter>);
    await screen.findByText('Out list');
    await act(() => new Promise((r) => setTimeout(r, 0))); // the list's load lands
    expect(screen.queryByText('Open games')).toBeNull();
    expect(screen.queryByText('No open games.')).toBeNull();
  });

  it('still lists a practice session this phone holds unsaved taps for, so they can upload', async () => {
    storeQueue('k1', DRILL, [{} as QueuedTap]);
    render(<MemoryRouter><TallyPage /></MemoryRouter>);
    const drill = (await screen.findByText('Sat, Nov 7 · Practice')).closest('li')!;
    expect(drill.textContent).toContain('1 unsaved');
  });
});

describe('TallyPage deep link', () => {
  it('opens the board for ?game= straight away', async () => {
    render(<MemoryRouter initialEntries={['/tally?game=game']}><TallyPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: '← Games' })).toBeTruthy();
  });

  it('pushes the games list on ← Games so Back returns to the board (B3)', async () => {
    const Back = () => { const navigate = useNavigate(); return <button onClick={() => void navigate(-1)}>Back</button>; };
    render(<MemoryRouter initialEntries={['/tally?game=game']}><TallyPage /><Back /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: '← Games' }));
    await screen.findByText('Out list');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('button', { name: '← Games' })).toBeTruthy();
    expect(await screen.findByText('A0')).toBeTruthy();
  });

  it('keeps a way back to the games when ?game= is bad or stale', async () => {
    gone.on = true;
    render(<MemoryRouter initialEntries={['/tally?game=nope']}><TallyPage /></MemoryRouter>);
    expect((await screen.findByRole('alert')).textContent).toContain('Row not found');
    fireEvent.click(screen.getByRole('button', { name: '← Games' }));
    expect(await screen.findByText('Open games')).toBeTruthy();
  });
});

describe('TallyPage board', () => {
  const board = async () => {
    const view = render(<MemoryRouter initialEntries={['/tally?game=game']}><TallyPage /></MemoryRouter>);
    await screen.findByText('A0');
    return view;
  };
  /** The board's headings and player names in page order. */
  const order = (c: HTMLElement) => [...c.querySelectorAll('h2, .tally-card strong')].map((e) => e.textContent);

  it('titles the bar with the game, "Game 2 vs UNC"', async () => {
    gone.games = [{ session_id: 'game', stage_id: 's1', number: 2, opponent: 'UNC', stages: { name: 'CCCs' } }];
    const { container } = await board();
    expect(container.querySelector('.tally-bar strong')!.textContent).toBe('Game 2 vs UNC · CCCs');
  });

  it('lists picked players first, then everyone else', async () => {
    gone.athletes = [{ id: 'a0', name: 'A0' }, { id: 'a1', name: 'A1' }, { id: 'a2', name: 'A2' }, { id: 'a3', name: 'A3' }];
    gone.starters = ['a3', 'a1'];
    const { container } = await board();
    expect(order(container)).toEqual(['Picked this game', 'A1', 'A3', 'Everyone else', 'A0', 'A2']);
    const find = screen.getByRole('searchbox', { name: 'Find a player' });
    fireEvent.change(find, { target: { value: 'a' } });
    expect(order(container)).toEqual(['A1', 'A3', 'A0', 'A2']); // no headings while searching
    fireEvent.change(find, { target: { value: 'A2' } });
    expect(order(container)).toEqual(['A2']);
  });

  it("shows one A→Z list when the starters don't load", async () => {
    gone.starters = null;
    const { container } = await board();
    expect(order(container)).toEqual(['A0', 'A1']);
  });

  it('keeps one A→Z list for the visit when the starters land after the wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let land: (s: Set<string>) => void = () => {};
      gone.late = new Promise((r) => { land = r; });
      gone.athletes = [{ id: 'a0', name: 'A0' }, { id: 'a1', name: 'A1' }];
      const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
      const { container } = render(<MemoryRouter initialEntries={['/tally?game=game']}><TallyPage /></MemoryRouter>);
      for (let i = 0; i < 20 && vi.getTimerCount() === 0; i++) await tick(0); // until the board's first load starts the wait
      await tick(STARTERS_WAIT_MS - 1);
      expect(screen.queryByText('A0')).toBeNull(); // still waiting
      await tick(1);
      expect(order(container)).toEqual(['A0', 'A1']);
      land(new Set(['a1']));
      gone.outs = [{ athlete_id: 'a1', from_game: 3 }]; // shows when the reload after Mark out lands
      fireEvent.click(screen.getByRole('button', { name: 'Mark A0 out from the next game' }));
      for (let i = 0; i < 20 && !screen.queryByText('Out from game 3'); i++) await tick(0);
      expect(screen.getByText('Out from game 3')).toBeTruthy();
      expect(order(container)).toEqual(['A0', 'A1']); // never regroups under a keeper's thumb
    } finally {
      vi.useRealTimers();
    }
  });

  it('folds an Out player to one line with Clear out and no stat buttons', async () => {
    gone.outs = [{ athlete_id: 'a0', from_game: 2 }]; // Out of this board's game, game 2
    await board();
    const card = screen.getByText('A0').closest('li')!;
    expect(card.querySelector('.pill.bad')!.textContent).toBe('Out');
    expect(card.querySelector('.tally-buttons')).toBeNull();
    expect([...card.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Clear out']);
    expect(screen.getByText('A1').closest('li')!.querySelector('.tally-buttons')).toBeTruthy();
  });

  it('puts Finish game at the end of the board, not in the bar', async () => {
    const { container } = await board();
    const finish = screen.getByRole('button', { name: 'Finish game 2' });
    expect(finish.closest('.tally-bar')).toBeNull();
    const lists = container.querySelectorAll('ul.list');
    expect(lists.length).toBeGreaterThan(0);
    expect(lists[lists.length - 1].compareDocumentPosition(finish) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says "Hold a stat to take one off."', async () => {
    await board();
    expect(screen.getByText('Hold a stat to take one off.')).toBeTruthy();
  });
});

describe('TallyPage Out toggle', () => {
  const board = async () => {
    render(<MemoryRouter initialEntries={['/tally?game=game']}><TallyPage /></MemoryRouter>);
    await screen.findByText('A0');
  };

  it('marks a player out from the board', async () => {
    await board();
    gone.outs = [{ athlete_id: 'a0', from_game: 3 }]; // what the reload after the click reads
    fireEvent.click(screen.getByRole('button', { name: 'Mark A0 out from the next game' }));
    await waitFor(() => expect(api.setOut).toHaveBeenCalledWith('s1', 'a0'));
    expect((await screen.findByText('Out from game 3')).className).toContain('pill');
    expect(screen.getByRole('button', { name: "Clear A0's Out" })).toBeTruthy();
    expect(screen.getByText('A0').closest('li')!.querySelector('.tally-buttons')).toBeTruthy(); // he still plays this game
  });

  it('clears an Out from the board', async () => {
    gone.outs = [{ athlete_id: 'a0', from_game: 1 }];
    await board();
    expect((await screen.findByText('Out')).className).toContain('pill');
    fireEvent.click(screen.getByRole('button', { name: "Clear A0's Out" }));
    await waitFor(() => expect(api.clearOut).toHaveBeenCalledWith('s1', 'a0'));
  });

  it("reads plain Out on an earlier game's board once the Out's game has started", async () => {
    // Board of game 1; game 3 (where the Out begins) is already live, so only the stage's started games count.
    gone.games = [{ session_id: 'game', stage_id: 's1', number: 1 }, { session_id: 'g3', stage_id: 's1', number: 3 }];
    gone.outs = [{ athlete_id: 'a0', from_game: 3 }];
    await board();
    expect((await screen.findByText('Out')).className).toContain('pill');
    expect(screen.queryByText('Out from game 3')).toBeNull();
  });

  it('has no attendance or injury controls', async () => {
    await board();
    expect(screen.queryByText(/Mark present|Present ✓|Absent|Confirm injury|Injur/)).toBeNull();
  });

  it('shows Mark out for your own players too', async () => {
    gone.owned = true;
    await board();
    await screen.findByText('On your team');
    const stat = screen.getAllByRole('button').find((b) => /^A0, /.test(b.getAttribute('aria-label') ?? ''))!;
    expect((stat as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Mark A0 out from the next game' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('TallyPage bright board (t330)', () => {
  const tally = () => document.documentElement.dataset.tally;
  const open = async () => {
    render(<MemoryRouter initialEntries={['/tally?game=game']}><TallyPage /></MemoryRouter>);
    await screen.findByText('A0');
  };

  const bright = () => screen.getByRole('checkbox', { name: 'Bright board' }) as HTMLInputElement;

  it('switches the bright board with a checkbox', async () => {
    await open();
    expect(tally()).toBe('bright');
    expect(bright().checked).toBe(true); // bright by default
    expect(bright().closest('.tally-bar')).toBeTruthy();
    fireEvent.click(bright());
    expect(tally()).toBeUndefined();
    expect(bright().checked).toBe(false);
  });

  it('remembers a keeper turning it off on this device', async () => {
    await open();
    fireEvent.click(bright());
    expect(tally()).toBeUndefined();
    expect(localStorage.getItem('tribe.tally.bright')).toBe('0');
    cleanup();
    await open();
    expect(tally()).toBeUndefined();
    expect(bright().checked).toBe(false);
    fireEvent.click(bright());
    expect(tally()).toBe('bright');
    expect(localStorage.getItem('tribe.tally.bright')).toBe('1');
  });

  it('leaves the games list and every other page as they were', async () => {
    render(<MemoryRouter initialEntries={['/tally']}><TallyPage /></MemoryRouter>);
    await screen.findByText('Open games');
    expect(tally()).toBeUndefined();
    cleanup();
    await open();
    fireEvent.click(screen.getByRole('button', { name: '← Games' }));
    await screen.findByText('Open games');
    expect(tally()).toBeUndefined();
    cleanup();
    await open();
    expect(tally()).toBe('bright');
    cleanup(); // unmounting is leaving: a tab, Back, the menu
    expect(tally()).toBeUndefined();
  });

  it('stays bright when storage is blocked', async () => {
    const blocked = () => { throw new Error('blocked'); };
    const spies = [vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked), vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)];
    try {
      await open();
      expect(tally()).toBe('bright');
      fireEvent.click(bright());
      expect(tally()).toBeUndefined();
      expect(bright().checked).toBe(false);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});
