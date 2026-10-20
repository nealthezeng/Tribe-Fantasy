// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { removeMessage, UsersPanel, type UserRow } from './UsersPanel';

vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'me' } }, loading: false }) }));

const ALEX: UserRow = {
  id: 'u1', email: 'alex@x.test', display_name: 'Alex Kim', roles: ['stat_keeper'],
  teams: [{ membership_id: 'm1', league: 'League A', team: 'Gimp Zeal', season: 'Fall' }],
  athlete: { id: 'a1', name: 'Alex Kim' }, donations: { count: 2, dollars: 30 },
};
const ME: UserRow = {
  id: 'me', email: 'me@x.test', display_name: 'Me Admin', roles: ['admin'], teams: [], athlete: null, donations: { count: 0, dollars: 0 },
};
const BARE: UserRow = { id: 'u3', email: 'bo@x.test', display_name: null, roles: [], teams: [], athlete: null, donations: { count: 0, dollars: 0 } };

vi.mock('../../lib/rpc', () => ({ api: {
  listUsers: vi.fn(() => Promise.resolve([ALEX, ME, BARE])),
  grantRole: vi.fn(() => Promise.resolve()),
  revokeRole: vi.fn(() => Promise.resolve()),
  adminSetDisplayName: vi.fn(() => Promise.resolve()),
  adminRemoveUser: vi.fn(() => Promise.resolve({ teams: 1, donations: 2 })),
} }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const row = async (name: string) => (await screen.findByText(name)).closest('li') as HTMLElement;

describe('removeMessage', () => {
  it('names the team, donations and player', () => {
    expect(removeMessage(ALEX)).toBe(
      "Remove Alex Kim (alex@x.test)? Their team Gimp Zeal leaves League A: it keeps the points it has, forfeits its remaining games and stops being paired. "
      + 'Their 2 donations ($30) stay in the records. Their player profile Alex Kim stays, unlinked. '
      + 'Their roles (Stat keeper) go. Any buys in open share buying are cancelled. They can\'t sign in. This can\'t be undone.');
  });
  it('says teams for two, and drops sentences for what is absent', () => {
    const two = { ...ALEX, athlete: null, donations: { count: 0, dollars: 0 }, teams: [
      ALEX.teams[0], { membership_id: 'm2', league: 'League B', team: 'Money', season: 'Fall' }] };
    expect(removeMessage(two)).toBe(
      "Remove Alex Kim (alex@x.test)? Their teams Gimp Zeal (League A) and Money (League B) leave their leagues: they keep the points they have, "
      + "forfeit their remaining games and stop being paired. Their roles (Stat keeper) go. Any buys in open share buying are cancelled. They can't sign in. This can't be undone.");
    const three = { ...two, teams: [...two.teams, { membership_id: 'm3', league: 'Lc', team: 'C', season: 'Fall' }] };
    expect(removeMessage({ ...three, teams: [{ ...three.teams[0], team: 'A', league: 'La' }, { ...three.teams[1], team: 'B', league: 'Lb' }, three.teams[2]] }))
      .toContain('Their teams A (La), B (Lb) and C (Lc) leave their leagues');
    expect(removeMessage({ ...ALEX, athlete: null, donations: { count: 1, dollars: 10 } })).toContain('Their 1 donation ($10) stays in the records.');
    expect(removeMessage({ ...ALEX, roles: ['stat_keeper', 'admin'], teams: [] })).toContain('Their roles (Stat keeper, Admin) go. They can');
    expect(removeMessage(BARE)).toBe("Remove bo@x.test? They can't sign in. This can't be undone.");
  });
});

describe('UsersPanel (M14 T5)', () => {
  it('lists people with email, teams and roles, and search filters by name or email', async () => {
    render(<UsersPanel />);
    const alex = await row('Alex Kim');
    expect(within(alex).getByText('alex@x.test')).toBeTruthy();
    expect(within(alex).getByText('Gimp Zeal (League A)')).toBeTruthy();
    expect(within(alex).getByText('Stat keeper')).toBeTruthy();
    expect(within(alex).getByText('Player: Alex Kim')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'bo@' } });
    expect(screen.queryByText('Alex Kim')).toBeNull();
    expect(screen.getByText('bo@x.test')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'alex k' } });
    expect(screen.getByText('Alex Kim')).toBeTruthy();
    expect(screen.queryByText('bo@x.test')).toBeNull();
  });

  it('every role button label starts with its visible text (WCAG 2.5.3)', async () => {
    render(<UsersPanel />);
    const alex = await row('Alex Kim');
    for (const b of within(alex).getAllByRole('button')) {
      const label = b.getAttribute('aria-label');
      if (label) expect(label.startsWith(b.textContent!)).toBe(true);
    }
  });

  it('Remove asks the exact confirm and only removes on OK', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<UsersPanel />);
    const alex = await row('Alex Kim');
    fireEvent.click(within(alex).getByRole('button', { name: /^Remove account/ }));
    expect(confirm).toHaveBeenCalledWith(removeMessage(ALEX));
    expect(api.adminRemoveUser).not.toHaveBeenCalled();
    fireEvent.click(within(alex).getByRole('button', { name: /^Remove account/ }));
    await waitFor(() => expect(api.adminRemoveUser).toHaveBeenCalledWith('u1'));
  });

  it('cannot remove yourself', async () => {
    render(<UsersPanel />);
    const me = await row('Me Admin');
    expect((within(me).getByRole('button', { name: /^Remove account/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('role buttons grant and revoke stat keeper, treasurer and admin', async () => {
    render(<UsersPanel />);
    const alex = await row('Alex Kim');
    fireEvent.click(within(alex).getByRole('button', { name: 'Remove stat keeper: Alex Kim' }));
    await waitFor(() => expect(api.revokeRole).toHaveBeenCalledWith('u1', 'stat_keeper'));
    fireEvent.click(within(alex).getByRole('button', { name: 'Make treasurer: Alex Kim' }));
    await waitFor(() => expect(api.grantRole).toHaveBeenCalledWith('u1', 'treasurer'));
    fireEvent.click(within(alex).getByRole('button', { name: 'Make admin: Alex Kim' }));
    await waitFor(() => expect(api.grantRole).toHaveBeenCalledWith('u1', 'admin'));
    fireEvent.click(within(await row('Me Admin')).getByRole('button', { name: 'Remove admin: Me Admin' }));
    await waitFor(() => expect(api.revokeRole).toHaveBeenCalledWith('me', 'admin'));
  });

  it('shows the sentence when the last admin cannot be revoked', async () => {
    vi.mocked(api.revokeRole).mockRejectedValueOnce({ message: 'LAST_ADMIN' });
    render(<UsersPanel />);
    fireEvent.click(within(await row('Me Admin')).getByRole('button', { name: 'Remove admin: Me Admin' }));
    expect((await screen.findByRole('alert')).textContent).toBe("You can't remove the last admin.");
  });

  it('shows the error when a remove fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.adminRemoveUser).mockRejectedValueOnce({ message: 'NOT_FOUND' });
    render(<UsersPanel />);
    fireEvent.click(within(await row('Alex Kim')).getByRole('button', { name: /^Remove account/ }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/no longer there/);
  });

  it('offers no Rename on a person with no profile name', async () => {
    render(<UsersPanel />);
    const bo = await row('bo@x.test');
    expect(within(bo).queryByRole('button', { name: /^Rename/ })).toBeNull();
    expect(within(bo).getByRole('button', { name: 'Remove account bo@x.test' })).toBeTruthy();
  });

  it('edits a display name', async () => {
    render(<UsersPanel />);
    fireEvent.click(within(await row('Alex Kim')).getByRole('button', { name: 'Rename Alex Kim' }));
    fireEvent.change(screen.getByLabelText('New name for Alex Kim'), { target: { value: 'Alexander Kim' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.adminSetDisplayName).toHaveBeenCalledWith('u1', 'Alexander Kim'));
  });
});
