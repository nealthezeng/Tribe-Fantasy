// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { api } from '../lib/rpc';
import { loadQueue, storeQueue, type QueuedTap } from '../tally/queue';
import { TallyPage } from './TallyPage';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'k1' } }, isAdmin: true, isKeeper: true, loading: false }),
}));
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve({ id: 'se', name: 'Fall', settings: parseSettings({}) }),
}));
vi.mock('./GameControls', () => ({ GameControls: () => null }));
vi.mock('../lib/rpc', () => ({ api: { saveTaps: vi.fn() } }));

const GAME = '00000000-0000-4000-8000-0000000000a1';
const db = vi.hoisted(() => ({ lookupFails: false }));
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const session = { id: GAME, season_id: 'se', kind: 'tournament', held_on: '2026-11-07', counts: true, created_by: 'k1',
        verified_by: null, verified_at: null };
      // Alice still exists; the player 'gone' was force-deleted.
      const rows = table === 'sessions' ? [session] : table === 'games' ? [{ session_id: GAME, number: 2 }]
        : table === 'athletes' ? [{ id: 'a', name: 'Alice' }] : [];
      let lookup = false; // athletes.in(...) is the NOT_FOUND re-check
      const result = () => (lookup && db.lookupFails ? { data: null, error: new Error('offline') } : { data: rows, error: null });
      const builder = {
        select: () => builder, or: () => builder, order: () => builder, eq: () => builder, is: () => builder,
        in: () => { lookup = table === 'athletes'; return builder; },
        single: () => Promise.resolve({ data: rows[0], error: null }),
        then: (resolve: (v: unknown) => void) => resolve(result()),
      };
      return builder;
    },
  },
}));

const tap = (id: string, athlete: string): QueuedTap => ({
  id, athlete_id: athlete, stat: 'goal', tapped_at: '2026-11-07T15:00:00.000Z', undoes: null,
});
const hide = () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent(document, new Event('visibilitychange'));
};

beforeEach(() => {
  db.lookupFails = false;
  vi.mocked(api.saveTaps).mockReset();
  vi.mocked(api.saveTaps).mockRejectedValueOnce(new Error('NOT_FOUND')).mockResolvedValue(2);
  storeQueue('k1', GAME, [tap('t1', 'a'), tap('t2', 'gone'), tap('t3', 'a')]);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function openBoard() {
  render(<MemoryRouter><TallyPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Tally' }));
  await screen.findByText('Alice');
}

describe('TallyBoard after a NOT_FOUND batch (t203)', () => {
  it("drops only the deleted player's taps and saves the rest", async () => {
    await openBoard();
    hide();
    await screen.findByText(/1 tap not saved: the player was deleted by an admin/);
    expect(loadQueue('k1', GAME).map((t) => t.id)).toEqual(['t1', 't3']);
    hide();
    await waitFor(() => expect(api.saveTaps).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.saveTaps).mock.calls[1][2].map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('keeps every tap queued when the re-check itself fails', async () => {
    db.lookupFails = true;
    await openBoard();
    hide();
    await waitFor(() => expect(api.saveTaps).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/not saved/)).toBeNull();
    expect(loadQueue('k1', GAME)).toHaveLength(3);
  });
});
