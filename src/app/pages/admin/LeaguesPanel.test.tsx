// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { LeaguesPanel } from './LeaguesPanel';

const ROWS: Record<string, unknown[]> = {
  leagues: [
    { id: 'l1', name: 'Huck Yeah', created_by: 'u1', memberships: [{ id: 'm1', team_name: 'Zips' }, { id: 'm2', team_name: 'Hucks' }] },
    { id: 'l2', name: 'League A', created_by: null, memberships: [] },
  ],
  profiles: [{ id: 'u1', display_name: 'Alice' }],
};
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder, in: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: ROWS[table], error: null }),
      };
      return builder;
    },
  },
}));
vi.mock('../../lib/rpc', () => ({ api: {
  // Only the current season's leagues come back: League A (l2) is from an older season here, so its lock is unknown.
  listLeagues: vi.fn(() => Promise.resolve([{ id: 'l1', has_password: false }])),
  deleteLeague: vi.fn(() => Promise.resolve()),
  setLeaguePassword: vi.fn(() => Promise.resolve()),
} }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('LeaguesPanel (t215)', () => {
  it('lists every league with its creator and teams, and no invite codes', async () => {
    render(<LeaguesPanel seasonId="s1" />);
    expect(await screen.findByText('by Alice · 2 teams')).toBeTruthy();
    expect(screen.getByText('by An admin · 0 teams')).toBeTruthy();
    expect(screen.getByText('Zips, Hucks')).toBeTruthy();
    expect(screen.queryByText(/invite/i)).toBeNull();
  });

  it("sets or removes any league's password, so admins can lock a league they aren't in (review fix)", async () => {
    render(<LeaguesPanel seasonId="s1" />);
    fireEvent.change(await screen.findByLabelText('New password for League A'), { target: { value: ' secret1 ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Set password' })[1]);
    await waitFor(() => expect(api.setLeaguePassword).toHaveBeenCalledWith('l2', ' secret1 '));
    expect(await screen.findByText('League A now needs a password.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Make League A public' }));
    await waitFor(() => expect(api.setLeaguePassword).toHaveBeenCalledWith('l2', null));
  });

  it('says which leagues are public, and offers Make public only where it changes something', async () => {
    render(<LeaguesPanel seasonId="s1" />);
    expect(await screen.findByText('Public')).toBeTruthy();
    expect(screen.queryByText('Password')).toBeNull();
    expect((screen.getByRole('button', { name: 'Make Huck Yeah public' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Make League A public' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('refuses a password of only spaces', async () => {
    render(<LeaguesPanel seasonId="s1" />);
    fireEvent.change(await screen.findByLabelText('New password for League A'), { target: { value: '     ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Set password' })[1]);
    expect((await screen.findByRole('alert')).textContent).toMatch(/4–40 characters/);
    expect(api.setLeaguePassword).not.toHaveBeenCalled();
  });

  it('deletes a league only after the confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<LeaguesPanel seasonId="s1" />);
    const del = await screen.findByRole('button', { name: 'Delete Huck Yeah' });
    fireEvent.click(del);
    expect(api.deleteLeague).not.toHaveBeenCalled();
    fireEvent.click(del);
    await waitFor(() => expect(api.deleteLeague).toHaveBeenCalledWith('l1'));
    expect(confirm.mock.calls[0][0]).toMatch(/^Delete Huck Yeah\? Its 2 teams/);
  });
});
