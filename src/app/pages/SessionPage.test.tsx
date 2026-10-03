// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/rpc';
import { SessionPage } from './SessionPage';

const auth = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, isAdmin: auth.isAdmin, isKeeper: true }),
}));

// A verified session, long past its lock.
const session = {
  id: 's1', season_id: 'se1', kind: 'practice', held_on: '2026-11-16', counts: true,
  created_by: 'k1', verified_by: 'k2', verified_at: '2026-01-01T00:00:00Z',
};
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === 'stat_lines' ? [{ athlete_id: 'a1', stats: { goal: 1 } }]
        : table === 'athletes' ? [{ id: 'a1', name: 'Sam' }] : [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        maybeSingle: () => Promise.resolve({ data: session, error: null }),
        single: () => Promise.resolve({ data: { settings: {} }, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  },
}));

vi.mock('../lib/rpc', () => ({ api: { deleteSession: vi.fn() } }));

const confirm = vi.fn();
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.deleteSession).mockReset();
  confirm.mockReset();
  window.confirm = confirm;
});

const renderPage = () => render(
  <MemoryRouter initialEntries={['/stats/s1']}>
    <Routes>
      <Route path="/stats/:id" element={<SessionPage />} />
      <Route path="/stats" element={<p>ALL SESSIONS</p>} />
    </Routes>
  </MemoryRouter>,
);

describe('SessionPage delete (t81)', () => {
  it('lets an admin force-delete a locked session, then goes back to Stats', async () => {
    auth.isAdmin = true;
    confirm.mockReturnValue(true);
    vi.mocked(api.deleteSession).mockResolvedValue(undefined);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete these stats' }));
    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith('s1', true));
    expect(confirm.mock.calls[0][0]).toMatch(/Past results and standings can change/);
    expect(await screen.findByText('ALL SESSIONS')).toBeTruthy();
  });

  it('does nothing when the confirm is declined', async () => {
    auth.isAdmin = true;
    confirm.mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete these stats' }));
    expect(api.deleteSession).not.toHaveBeenCalled();
  });

  it('shows no Delete button to a keeper who is not an admin', async () => {
    auth.isAdmin = false;
    renderPage();
    await screen.findByText('Attendance');
    expect(screen.queryByRole('button', { name: 'Delete these stats' })).toBeNull();
  });
});
