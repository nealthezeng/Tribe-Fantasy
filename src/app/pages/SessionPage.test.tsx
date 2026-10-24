// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/rpc';
import { SessionPage } from './SessionPage';

const auth = vi.hoisted(() => ({ isAdmin: true, isKeeper: true }));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, isAdmin: auth.isAdmin, isKeeper: auth.isKeeper }),
}));

// A verified session, long past its lock (tests flip it to live).
const session = {
  id: 's1', season_id: 'se1', kind: 'tournament', held_on: '2026-11-16', counts: true,
  created_by: 'k1', verified_by: 'k2', verified_at: '2026-01-01T00:00:00Z' as string | null,
};
// The open game's taps (keepers read stat_taps); tests add one by the signed-in keeper, u1.
const taps: { id: string; athlete_id: string; stat: string; keeper_id: string; tapped_at: string; undoes: null }[] = [];
const game = { id: 'g1', stage_id: 'S9', number: 1, opponent: 'Duke', started_at: '2026-11-16T10:00:00Z', finished_at: '2026-11-16T11:00:00Z' as string | null, stages: { name: 'CCCs' } };
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === 'stat_lines' ? [{ athlete_id: 'a1', stats: { goal: 1 } }]
        : table === 'athletes' ? [{ id: 'a1', name: 'Sam' }] : table === 'stat_taps' ? taps : [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        maybeSingle: () => Promise.resolve({ data: table === 'games' ? game : session, error: null }),
        single: () => Promise.resolve({ data: { settings: {} }, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  },
}));

vi.mock('../lib/rpc', () => ({ api: { deleteSession: vi.fn(), liveGameTaps: vi.fn() } }));

const confirm = vi.fn();
afterEach(cleanup);
beforeEach(() => {
  auth.isKeeper = true;
  session.verified_at = '2026-01-01T00:00:00Z';
  game.finished_at = '2026-11-16T11:00:00Z';
  taps.length = 0;
  vi.mocked(api.liveGameTaps).mockReset().mockResolvedValue([]);
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

describe('SessionPage back link', () => {
  it('goes back to the Stats tournament the game belongs to', async () => {
    renderPage();
    expect((await screen.findByRole('link', { name: '← Stats' })).getAttribute('href')).toBe('/stats?t=S9');
  });
});

describe('SessionPage', () => {
  it('has no Attendance card (nobody marks attendance any more)', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Stats' });
    expect(screen.queryByText('Attendance')).toBeNull();
  });

  it('titles the page Game 1 vs Duke with the tournament as small text', async () => {
    renderPage();
    const h1 = await screen.findByRole('heading', { level: 1 });
    expect(h1.firstChild!.textContent).toBe('Game 1 vs Duke');
    expect(h1.querySelector('small')!.textContent).toBe('CCCs');
    expect(screen.getByText('Final')).toBeTruthy(); // the status word, not a pill
    expect(document.querySelector('.pill')).toBeNull();
  });

  it('links player names to their pages', async () => {
    renderPage();
    expect((await screen.findByRole('link', { name: 'Sam' })).getAttribute('href')).toBe('/player/a1?t=S9');
  });

  it('shows a member the live lines as unofficial', async () => {
    auth.isKeeper = false;
    session.verified_at = null;
    game.finished_at = null;
    vi.mocked(api.liveGameTaps).mockResolvedValue([
      { id: 't1', athlete_id: 'a1', stat: 'goal', keeper: 1, tapped_at: '2026-11-16T10:05:00Z', undoes: null },
      { id: 't2', athlete_id: 'a1', stat: 'goal', keeper: 1, tapped_at: '2026-11-16T10:30:00Z', undoes: null },
    ]);
    renderPage();
    const heading = await screen.findByRole('heading', { name: /Stats/ });
    expect(heading.textContent).toContain('unofficial');
    expect(api.liveGameTaps).toHaveBeenCalledWith('g1');
    expect(screen.getByRole('link', { name: 'Sam' }).closest('tr')!.textContent).toContain('2');
    expect(document.querySelector('.live')!.textContent).toBe('Live');
    expect(screen.queryByText('Totals to verify')).toBeNull();
  });

  it('keeps the page when a later reload fails, with the error above it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      auth.isKeeper = false;
      session.verified_at = null;
      game.finished_at = null;
      vi.mocked(api.liveGameTaps)
        .mockResolvedValueOnce([{ id: 't1', athlete_id: 'a1', stat: 'goal', keeper: 1, tapped_at: '2026-11-16T10:05:00Z', undoes: null }])
        .mockRejectedValue(new Error('Failed to fetch'));
      renderPage();
      expect(await screen.findByRole('link', { name: 'Sam' })).toBeTruthy();
      await vi.advanceTimersByTimeAsync(15_000); // the poll's reload fails
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Game 1 vs Duke');
      expect(screen.getByRole('link', { name: '← Stats' })).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Sam' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never reads live taps for a keeper (they verify from their own taps)', async () => {
    session.verified_at = null;
    renderPage();
    await screen.findByRole('heading', { name: 'Totals to verify' });
    expect(api.liveGameTaps).not.toHaveBeenCalled();
  });

  it('shows the loading placeholder while the game loads', () => {
    renderPage();
    expect(screen.getByRole('status').className).toBe('skeleton'); // the shared Loading, not a bare "Loading…"
  });
});

describe('SessionPage verify (X8)', () => {
  const myTap = { id: 't1', athlete_id: 'a1', stat: 'goal', keeper_id: 'u1', tapped_at: '2026-11-16T10:05:00Z', undoes: null };

  it("says why a keeper who tallied can't verify, and who can", async () => {
    auth.isAdmin = false;
    session.verified_at = null;
    taps.push(myTap);
    renderPage();
    expect(await screen.findByText("You tallied this game, so you can't verify it. A keeper who didn't tally it can, or an admin.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify these totals' })).toBeNull();
  });

  it('lets an admin verify a game they tallied', async () => {
    auth.isAdmin = true;
    session.verified_at = null;
    taps.push(myTap);
    renderPage();
    expect(await screen.findByRole('button', { name: 'Verify these totals' })).toBeTruthy();
    expect(screen.queryByText(/You tallied this game/)).toBeNull();
  });
});

describe('SessionPage delete (t81)', () => {
  it('words Delete these stats red, after every other action (ruling 81)', async () => {
    auth.isAdmin = true;
    // Locked: the correction form's Save comes before it; open: Verify does.
    for (const [verified, other] of [['2026-01-01T00:00:00Z', 'Save correction'], [null, 'Verify these totals']] as const) {
      session.verified_at = verified;
      renderPage();
      const del = await screen.findByRole('button', { name: 'Delete these stats' });
      expect(screen.getByRole('button', { name: other })).toBeTruthy();
      expect(screen.getAllByRole('button').at(-1)).toBe(del);
      expect(del.className).toBe('danger-link');
      cleanup();
    }
  });

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
    await screen.findByRole('heading', { name: 'Stats' });
    expect(screen.queryByRole('button', { name: 'Delete these stats' })).toBeNull();
  });
});
