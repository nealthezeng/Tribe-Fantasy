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
const JO: UserRow = {
  id: 'u4', email: 'jo@x.test', display_name: 'Jo Park', roles: [], athlete: null, donations: { count: 0, dollars: 0 },
  teams: [{ membership_id: 'm4', league: 'League A', team: 'Money', season: 'Fall' }, { membership_id: 'm5', league: 'League B', team: 'Zips', season: 'Fall' }],
};

vi.mock('../../lib/rpc', () => ({ api: {
  listUsers: vi.fn(() => Promise.resolve([ALEX, ME, BARE, JO])),
  grantRole: vi.fn(() => Promise.resolve()),
  revokeRole: vi.fn(() => Promise.resolve()),
  adminSetDisplayName: vi.fn(() => Promise.resolve()),
  adminRemoveUser: vi.fn(() => Promise.resolve({ teams: 1, donations: 2 })),
} }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
/** A person's row: the summary that opens their actions. */
const row = async (name: string) => (await screen.findByText(name)).closest('summary') as HTMLElement;
/** Opens a person's row; their actions, inside the row's details. */
const open = async (name: string) => {
  const summary = await row(name);
  fireEvent.click(summary);
  const details = summary.closest('details')!;
  expect(details.open).toBe(true);
  return within(details);
};

describe('removeMessage', () => {
  it('names the team, donations and player', () => {
    expect(removeMessage(ALEX)).toBe(
      "Remove Alex Kim (alex@x.test)? Their team Gimp Zeal leaves League A: it keeps the points it has, scores 0 in any game it's paired in that hasn't started, and isn't paired again. "
      + 'Their 2 donations ($30) stay in the records. Their player profile Alex Kim stays, unlinked. '
      + 'Their roles (Stat keeper) go. Any buys in open share buying are cancelled. They can\'t sign in. This can\'t be undone.');
  });
  it('says teams for two, and drops sentences for what is absent', () => {
    const two = { ...ALEX, athlete: null, donations: { count: 0, dollars: 0 }, teams: [
      ALEX.teams[0], { membership_id: 'm2', league: 'League B', team: 'Money', season: 'Fall' }] };
    expect(removeMessage(two)).toBe(
      "Remove Alex Kim (alex@x.test)? Their teams Gimp Zeal (League A) and Money (League B) leave their leagues: they keep the points they have, "
      + "score 0 in any game they're paired in that hasn't started, and aren't paired again. Their roles (Stat keeper) go. Any buys in open share buying are cancelled. They can't sign in. This can't be undone.");
    const three = { ...two, teams: [...two.teams, { membership_id: 'm3', league: 'Lc', team: 'C', season: 'Fall' }] };
    expect(removeMessage({ ...three, teams: [{ ...three.teams[0], team: 'A', league: 'La' }, { ...three.teams[1], team: 'B', league: 'Lb' }, three.teams[2]] }))
      .toContain('Their teams A (La), B (Lb) and C (Lc) leave their leagues');
    expect(removeMessage({ ...ALEX, athlete: null, donations: { count: 1, dollars: 10 } })).toContain('Their 1 donation ($10) stays in the records.');
    expect(removeMessage({ ...ALEX, roles: ['stat_keeper', 'admin'], teams: [] })).toContain('Their roles (Stat keeper, Admin) go. They can');
    expect(removeMessage(BARE)).toBe("Remove bo@x.test? They can't sign in. This can't be undone.");
  });
  it('never says forfeit (the core has no forfeit rule)', () => {
    expect(removeMessage(ALEX)).not.toMatch(/forfeit/i);
    expect(removeMessage(JO)).not.toMatch(/forfeit/i);
  });
});

describe('UsersPanel (M15 P9 T17)', () => {
  it('is one row per person: the name, then roles in words or "{team} · {league}"; search filters by name or email', async () => {
    render(<UsersPanel />);
    const alex = await row('Alex Kim');
    expect(alex.className).toBe('row-link');
    expect(within(alex).getByText('Stat keeper')).toBeTruthy();
    expect(within(await row('Jo Park')).getByText('Money · League A, Zips · League B')).toBeTruthy();
    expect(within(await row('Me Admin')).getByText('Admin')).toBeTruthy();
    expect((await row('bo@x.test')).querySelector('small')).toBeNull();
    expect(alex.querySelectorAll('button')).toHaveLength(0); // the row is the button: nothing small beside it
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'bo@' } });
    expect(screen.queryByText('Alex Kim')).toBeNull();
    expect(screen.getByText('bo@x.test')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'alex@' } });
    expect(screen.getByText('Alex Kim')).toBeTruthy();
    expect(screen.queryByText('bo@x.test')).toBeNull();
  });

  it('opens to the email, three role checkboxes, the name with Save name, and Remove account last and red', async () => {
    render(<UsersPanel />);
    const alex = await open('Alex Kim');
    expect(alex.getByText('alex@x.test')).toBeTruthy();
    const boxes = alex.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => [b.labels![0].textContent!.trim(), b.checked])).toEqual([['Admin', false], ['Stat keeper', true], ['Treasurer', false]]);
    expect((alex.getByLabelText('Name') as HTMLInputElement).value).toBe('Alex Kim');
    const controls = [...alex.getByText('alex@x.test').closest('details')!.querySelectorAll('input, button')];
    const remove = alex.getByRole('button', { name: /^Remove account/ });
    expect(controls.at(-1)).toBe(remove);
    expect(controls.at(-2)).toBe(alex.getByRole('button', { name: 'Save name' }));
    expect(remove.className).toBe('danger-link');
  });

  it('toggling a role checkbox grants or revokes it', async () => {
    render(<UsersPanel />);
    const alex = await open('Alex Kim');
    /** Taps a box once the row's last toggle has settled (boxes are disabled while one is in flight). */
    const tap = async (label: string) => {
      const box = alex.getByLabelText(label) as HTMLInputElement;
      await waitFor(() => expect(box.disabled).toBe(false));
      fireEvent.click(box);
    };
    await tap('Stat keeper');
    await waitFor(() => expect(api.revokeRole).toHaveBeenCalledWith('u1', 'stat_keeper'));
    await tap('Treasurer');
    await waitFor(() => expect(api.grantRole).toHaveBeenCalledWith('u1', 'treasurer'));
    await tap('Admin');
    await waitFor(() => expect(api.grantRole).toHaveBeenCalledWith('u1', 'admin'));
  });

  it('confirms only before you untick your own admin box, and Cancel leaves it', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<UsersPanel />);
    const me = await open('Me Admin');
    const box = me.getByLabelText('Admin') as HTMLInputElement;
    fireEvent.click(box);
    expect(confirm).toHaveBeenCalledWith("Remove your own admin role? You lose Admin right away and can't give it back yourself; another admin has to.");
    expect(api.revokeRole).not.toHaveBeenCalled();
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(api.revokeRole).toHaveBeenCalledWith('me', 'admin'));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("ticking your own boxes, and unticking someone else's admin, asks nothing", async () => {
    vi.mocked(api.listUsers).mockResolvedValueOnce([{ ...ALEX, roles: ['admin'] }, ME]);
    const confirm = vi.spyOn(window, 'confirm');
    render(<UsersPanel />);
    fireEvent.click((await open('Alex Kim')).getByLabelText('Admin'));
    await waitFor(() => expect(api.revokeRole).toHaveBeenCalledWith('u1', 'admin'));
    fireEvent.click((await open('Me Admin')).getByLabelText('Treasurer'));
    await waitFor(() => expect(api.grantRole).toHaveBeenCalledWith('me', 'treasurer'));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("disables the row's role boxes while a toggle is in flight, so a second tap sends nothing", async () => {
    let done!: () => void;
    vi.mocked(api.grantRole).mockImplementationOnce(() => new Promise<void>((resolve) => { done = resolve; }));
    render(<UsersPanel />);
    const alex = await open('Alex Kim');
    fireEvent.click(alex.getByLabelText('Treasurer'));
    const boxes = alex.getAllByRole('checkbox') as HTMLInputElement[];
    await waitFor(() => expect(boxes.every((b) => b.disabled)).toBe(true));
    fireEvent.click(alex.getByLabelText('Treasurer'));
    fireEvent.click(alex.getByLabelText('Stat keeper'));
    expect(api.grantRole).toHaveBeenCalledTimes(1);
    expect(api.revokeRole).not.toHaveBeenCalled();
    done();
    await waitFor(() => expect(boxes.every((b) => !b.disabled)).toBe(true));
    expect(api.listUsers).toHaveBeenCalledTimes(2); // enabled again only once the reload landed
  });

  it('shows the sentence when the last admin cannot be revoked, in the opened row', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.revokeRole).mockRejectedValueOnce({ message: 'LAST_ADMIN' });
    render(<UsersPanel />);
    const me = await open('Me Admin');
    fireEvent.click(me.getByLabelText('Admin'));
    expect((await me.findByRole('alert')).textContent).toBe("You can't remove the last admin.");
  });

  it('Remove account asks the exact confirm and only removes on OK', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<UsersPanel />);
    const alex = await open('Alex Kim');
    fireEvent.click(alex.getByRole('button', { name: /^Remove account/ }));
    expect(confirm).toHaveBeenCalledWith(removeMessage(ALEX));
    expect(api.adminRemoveUser).not.toHaveBeenCalled();
    fireEvent.click(alex.getByRole('button', { name: /^Remove account/ }));
    await waitFor(() => expect(api.adminRemoveUser).toHaveBeenCalledWith('u1'));
  });

  it('cannot remove yourself', async () => {
    render(<UsersPanel />);
    const me = await open('Me Admin');
    expect((me.getByRole('button', { name: /^Remove account/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the error when a remove fails, in the opened row', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.adminRemoveUser).mockRejectedValueOnce({ message: 'NOT_FOUND' });
    render(<UsersPanel />);
    const alex = await open('Alex Kim');
    fireEvent.click(alex.getByRole('button', { name: /^Remove account/ }));
    expect((await alex.findByRole('alert')).textContent).toMatch(/no longer there/);
  });

  it('offers no name field on a person with no profile name', async () => {
    render(<UsersPanel />);
    const bo = await open('bo@x.test');
    expect(bo.queryByLabelText('Name')).toBeNull();
    expect(bo.queryByRole('button', { name: 'Save name' })).toBeNull();
    expect(bo.getAllByRole('checkbox')).toHaveLength(3);
    expect(bo.getByRole('button', { name: 'Remove account bo@x.test' })).toBeTruthy();
  });

  it('saves a display name', async () => {
    render(<UsersPanel />);
    const alex = await open('Alex Kim');
    fireEvent.change(alex.getByLabelText('Name'), { target: { value: 'Alexander Kim' } });
    fireEvent.click(alex.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(api.adminSetDisplayName).toHaveBeenCalledWith('u1', 'Alexander Kim'));
  });
});
