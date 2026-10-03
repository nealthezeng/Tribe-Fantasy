// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { TallyPage } from './TallyPage';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'k1' } }, isAdmin: false, isKeeper: true, loading: false }),
}));
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve({ id: 'se', name: 'Fall', settings: parseSettings({}) }),
}));
vi.mock('./GameControls', () => ({ GameControls: () => null }));

const session = (id: string, kind: string) => ({
  id, season_id: 'se', kind, held_on: '2026-11-07', counts: true, created_by: 'k1', verified_by: null, verified_at: null,
});
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === 'sessions' ? [session('game', 'tournament'), session('drill', 'practice')]
        : table === 'games' ? [{ session_id: 'game', number: 2 }] : [];
      const builder = {
        select: () => builder, or: () => builder, order: () => builder, in: () => builder, eq: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  },
}));

afterEach(cleanup);

describe('TallyPage session list', () => {
  it("labels a game's session and never offers to delete it (that would void the game)", async () => {
    render(<MemoryRouter><TallyPage /></MemoryRouter>);
    const game = (await screen.findByText('Game 2')).closest('li')!;
    expect(game.textContent).not.toContain('Delete');
    const drill = screen.getByText('Sat, Nov 7 · Practice').closest('li')!;
    expect(drill.textContent).toContain('Delete');
  });
});
