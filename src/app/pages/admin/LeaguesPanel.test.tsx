// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { LeaguesPanel } from './LeaguesPanel';

const ROWS: Record<string, unknown[]> = {
  leagues: [
    { id: 'l1', name: 'Huck Yeah', created_by: 'u1', memberships: [{ id: 'm1', team_name: 'Zips', removed_at: null }, { id: 'm2', team_name: 'Hucks', removed_at: null }] },
    { id: 'l2', name: 'League A', created_by: null, memberships: [] },
    { id: 'l3', name: 'Ghost League', created_by: 'gone', memberships: [
      { id: 'm3', team_name: 'Live', removed_at: null }, { id: 'm4', team_name: 'Left', removed_at: '2026-10-19T00:00:00Z' }] },
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
  listLeagues: vi.fn(() => Promise.resolve([{ id: 'l1', has_password: false }, { id: 'l3', has_password: true }])),
  deleteLeague: vi.fn(() => Promise.resolve()),
  setLeaguePassword: vi.fn(() => Promise.resolve()),
} }));
// The browser is its own tested component: here it only says which league it shows.
vi.mock('./LeagueBrowser', () => ({
  LeagueBrowser: ({ leagueId, onClose }: { leagueId: string; onClose: () => void }) => <button onClick={onClose}>Browser of {leagueId}</button>,
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

/** A league's closed row: its summary. */
const row = (name: string) => screen.getByText(name).closest<HTMLElement>('summary.row-link')!;
/** Opens a league's row (P9 rule 1) and returns what it holds. */
const openRow = async (name: string) => {
  fireEvent.click((await screen.findByText(name)).closest('summary')!);
  const details = row(name).closest('details')!;
  expect(details.open).toBe(true);
  return within(details);
};

describe('LeaguesPanel (t215, P9 T18)', () => {
  it('shows each league as one row: its name, who can join, its live teams and who made it, and no invite codes', async () => {
    render(<LeaguesPanel seasonId="s1" />);
    await screen.findByText('Huck Yeah');
    expect(within(row('Huck Yeah')).getByText('Open to anyone')).toBeTruthy();
    expect(within(row('Huck Yeah')).getByText('2 teams · Made by Alice')).toBeTruthy();
    expect(within(row('Ghost League')).getByText('Needs a password')).toBeTruthy();
    expect(within(row('Ghost League')).getByText('1 team · Made by a removed user')).toBeTruthy();
    // An older season's league: its lock is unknown, so the row says nothing about it.
    expect(row('League A').textContent).toBe('League A0 teams · Made by an admin');
    expect(screen.queryByText(/invite/i)).toBeNull();
    expect(screen.queryByText(/^(Public|Password)$/)).toBeNull();
  });

  it('opens to its teams, removed ones marked, and Open league shows the league browser', async () => {
    render(<LeaguesPanel seasonId="s1" />);
    expect((await openRow('Huck Yeah')).getByText('Zips, Hucks')).toBeTruthy();
    const ghost = await openRow('Ghost League');
    expect(ghost.getByText('Live, Left (removed)')).toBeTruthy();
    fireEvent.click(ghost.getByRole('button', { name: 'Open league Ghost League' }));
    fireEvent.click(screen.getByRole('button', { name: 'Browser of l3' }));
    expect(await screen.findByText('Huck Yeah')).toBeTruthy(); // Back to the list
  });

  it('adds a password to an open league, with no Remove password there', async () => {
    render(<LeaguesPanel seasonId="s1" />);
    const huck = await openRow('Huck Yeah');
    expect(huck.queryByRole('button', { name: 'Remove password for Huck Yeah' })).toBeNull();
    fireEvent.change(huck.getByLabelText('New password for Huck Yeah'), { target: { value: ' secret1 ' } });
    fireEvent.click(huck.getByRole('button', { name: 'Add a password for Huck Yeah' }));
    await waitFor(() => expect(api.setLeaguePassword).toHaveBeenCalledWith('l1', ' secret1 '));
    expect(await huck.findByText('Huck Yeah now needs a password.')).toBeTruthy();
  });

  it('changes or removes the password of a locked league, Remove password with no confirm (as before)', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    render(<LeaguesPanel seasonId="s1" />);
    const ghost = await openRow('Ghost League');
    expect(ghost.queryByRole('button', { name: 'Add a password for Ghost League' })).toBeNull();
    fireEvent.change(ghost.getByLabelText('New password for Ghost League'), { target: { value: 'secret22' } });
    fireEvent.click(ghost.getByRole('button', { name: 'Change password for Ghost League' }));
    await waitFor(() => expect(api.setLeaguePassword).toHaveBeenCalledWith('l3', 'secret22'));
    fireEvent.click(ghost.getByRole('button', { name: 'Remove password for Ghost League' }));
    await waitFor(() => expect(api.setLeaguePassword).toHaveBeenCalledWith('l3', null));
    expect(await ghost.findByText('Anyone can join Ghost League now.')).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("keeps both password actions for an older season's league, whose lock is unknown", async () => {
    render(<LeaguesPanel seasonId="s1" />);
    const a = await openRow('League A');
    expect(a.getByRole('button', { name: 'Add a password for League A' })).toBeTruthy();
    fireEvent.click(a.getByRole('button', { name: 'Remove password for League A' }));
    await waitFor(() => expect(api.setLeaguePassword).toHaveBeenCalledWith('l2', null));
  });

  it("names every action after its league, so rows opened side by side don't repeat the same names (visible words unchanged)", async () => {
    render(<LeaguesPanel seasonId="s1" />);
    const huck = await openRow('Huck Yeah');
    const ghost = await openRow('Ghost League');
    expect(huck.getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual(['Open league Huck Yeah', 'Add a password for Huck Yeah', 'Delete league Huck Yeah']);
    expect(ghost.getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Open league', 'Change password', 'Remove password', 'Delete league']);
    expect(ghost.getByLabelText('New password for Ghost League')).toBeTruthy();
  });

  it('refuses a password of only spaces', async () => {
    render(<LeaguesPanel seasonId="s1" />);
    const a = await openRow('League A');
    fireEvent.change(a.getByLabelText('New password for League A'), { target: { value: '     ' } });
    fireEvent.click(a.getByRole('button', { name: 'Add a password for League A' }));
    expect((await a.findByRole('alert')).textContent).toMatch(/4–40 characters/);
    expect(api.setLeaguePassword).not.toHaveBeenCalled();
  });

  it('puts Delete league last in red words, and deletes only after the confirm, word for word', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<LeaguesPanel seasonId="s1" />);
    const huck = await openRow('Huck Yeah');
    const del = huck.getByRole('button', { name: 'Delete league Huck Yeah' });
    expect(huck.getAllByRole('button').at(-1)).toBe(del);
    expect([del.textContent, del.className]).toEqual(['Delete league', 'danger-link']);
    fireEvent.click(del);
    expect(api.deleteLeague).not.toHaveBeenCalled();
    fireEvent.click(del);
    await waitFor(() => expect(api.deleteLeague).toHaveBeenCalledWith('l1'));
    expect(confirm.mock.calls[0][0]).toBe("Delete Huck Yeah? Its 2 teams, their credits, shares and rosters go with it. This can't be undone.");
  });

  it("says why a delete failed inside that league's row", async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.deleteLeague).mockRejectedValueOnce({ message: 'FORBIDDEN' });
    render(<LeaguesPanel seasonId="s1" />);
    const huck = await openRow('Huck Yeah');
    fireEvent.click(huck.getByRole('button', { name: 'Delete league Huck Yeah' }));
    expect((await huck.findByRole('alert')).textContent).toBe("You don't have permission to do that.");
  });
});
