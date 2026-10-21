// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { api } from '../lib/rpc';
import { storeQueue, type QueuedTap } from '../tally/queue';
import { TallyPage } from './TallyPage';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'k1' } }, isAdmin: false, isKeeper: true, loading: false }),
}));
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve({ id: 'se', name: 'Fall', settings: parseSettings({}) }),
}));
vi.mock('./GameControls', () => ({ GameControls: () => null }));
vi.mock('./OutList', () => ({ OutList: () => <p>Out list</p> }));
vi.mock('../lib/rpc', () => ({ api: { setOut: vi.fn(), clearOut: vi.fn() } }));

const gone = vi.hoisted(() => ({ on: false, outs: [] as { athlete_id: string; from_game: number }[], owned: false, games: null as unknown[] | null }));
const DRILL = '00000000-0000-4000-8000-00000000d111';
const session = (id: string, kind: string) => ({
  id, season_id: 'se', kind, held_on: '2026-11-07', counts: true, created_by: 'k1', verified_by: null, verified_at: null,
});
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === 'sessions' ? [session('game', 'tournament'), session(DRILL, 'practice')]
        : table === 'games' ? gone.games ?? [{ session_id: 'game', stage_id: 's1', number: 2 }]
        : table === 'athletes' ? [{ id: 'a0', name: 'A0' }, { id: 'a1', name: 'A1' }]
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
  cleanup();
  localStorage.clear();
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

  it('keeps a way back to the games when ?game= is bad or stale', async () => {
    gone.on = true;
    render(<MemoryRouter initialEntries={['/tally?game=nope']}><TallyPage /></MemoryRouter>);
    expect((await screen.findByRole('alert')).textContent).toContain('Row not found');
    fireEvent.click(screen.getByRole('button', { name: '← Games' }));
    expect(await screen.findByText('Open games')).toBeTruthy();
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
