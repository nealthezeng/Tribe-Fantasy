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
vi.mock('../../lib/rpc', () => ({ api: { deleteLeague: vi.fn(() => Promise.resolve()) } }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('LeaguesPanel (t215)', () => {
  it('lists every league with its creator and teams, and no invite codes', async () => {
    render(<LeaguesPanel seasonId="s1" />);
    expect(await screen.findByText('by Alice · 2 teams')).toBeTruthy();
    expect(screen.getByText('by An admin · 0 teams')).toBeTruthy();
    expect(screen.getByText('Zips, Hucks')).toBeTruthy();
    expect(screen.queryByText(/invite/i)).toBeNull();
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
