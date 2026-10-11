// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, type LeagueListing } from '../lib/rpc';
import { CreateLeaguePage, LeagueLeave, LeaguesPage, ManageLeague } from './LeaguesPage';

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }) }));
vi.mock('../lib/rpc', () => ({ api: {
  listLeagues: vi.fn(),
  joinOpenLeague: vi.fn(() => Promise.resolve('m1')),
  createMyLeague: vi.fn(() => Promise.resolve('l9')),
  renameLeague: vi.fn(() => Promise.resolve()),
  setLeaguePassword: vi.fn(() => Promise.resolve()),
  deleteLeague: vi.fn(() => Promise.resolve()),
  leaveLeague: vi.fn(() => Promise.resolve()),
} }));

const league = (over: Partial<LeagueListing>): LeagueListing => ({
  id: 'l1', name: 'Huck Yeah', teams: 2, max_teams: 6, has_password: false, is_member: false, is_creator: false, ...over,
});
const LEAGUES = [
  league({ id: 'a', name: 'Alpha Dogs', has_password: true }),
  league({ id: 'b', name: 'Bravo', teams: 6 }),
  league({ id: 'c', name: 'Huck Yeah', teams: 4, is_member: true }),
  league({ id: 'd', name: 'Zip Zap' }),
];

const at = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/" element={<p>home</p>} />
      <Route path="/leagues" element={<LeaguesPage />} />
      <Route path="/leagues/new" element={<CreateLeaguePage />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { vi.mocked(api.listLeagues).mockResolvedValue(LEAGUES); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('LeaguesPage (t215)', () => {
  it('shows N of M teams, Password, Full and Joined, and offers Join only where you can join', async () => {
    at('/leagues');
    expect(await screen.findByText('4 of 6 teams')).toBeTruthy();
    expect(screen.getByText('Password')).toBeTruthy();
    expect(screen.getByText('Full')).toBeTruthy();
    expect(screen.getByText('Joined')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Join / }).map((b) => b.getAttribute('aria-label')))
      .toEqual(['Join Alpha Dogs', 'Join Zip Zap']);
  });

  it('filters by name, ignoring case and spaces, and says when nothing matches', async () => {
    at('/leagues');
    const search = await screen.findByLabelText('Search leagues');
    fireEvent.change(search, { target: { value: '  ZIP ' } });
    expect(screen.getByText('Zip Zap')).toBeTruthy();
    expect(screen.queryByText('Bravo')).toBeNull();
    fireEvent.change(search, { target: { value: 'nope' } });
    expect(screen.getByText('No league matches "nope".')).toBeTruthy();
  });

  it('asks a locked league for its password and goes Home after joining', async () => {
    at('/leagues');
    fireEvent.click(await screen.findByRole('button', { name: 'Join Alpha Dogs' }));
    fireEvent.change(screen.getByLabelText('Your team name'), { target: { value: 'Zips' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join league' }));
    await waitFor(() => expect(api.joinOpenLeague).toHaveBeenCalledWith('a', 'secret1', 'Zips'));
    expect(await screen.findByText('home')).toBeTruthy();
  });

  it('sends no password to a public league and shows a refusal in place', async () => {
    vi.mocked(api.joinOpenLeague).mockRejectedValueOnce({ message: 'TEAM_NAME_TAKEN' });
    at('/leagues');
    fireEvent.click(await screen.findByRole('button', { name: 'Join Zip Zap' }));
    expect(screen.queryByLabelText('Password')).toBeNull();
    fireEvent.change(screen.getByLabelText('Your team name'), { target: { value: 'Zips' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join league' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already has that name/);
    expect(api.joinOpenLeague).toHaveBeenCalledWith('d', null, 'Zips');
  });

  it('invites you to create the first league when there are none', async () => {
    vi.mocked(api.listLeagues).mockResolvedValue([]);
    at('/leagues');
    expect(await screen.findByText('No leagues yet. Create the first one.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create a league' }).getAttribute('href')).toBe('/leagues/new');
  });
});

describe('CreateLeaguePage (t215)', () => {
  it('creates a public league by default', async () => {
    at('/leagues/new');
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'Huck Yeah' } });
    fireEvent.change(screen.getByLabelText('Your team name'), { target: { value: 'Zips' } });
    expect(screen.queryByLabelText('Password')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));
    await waitFor(() => expect(api.createMyLeague).toHaveBeenCalledWith('Huck Yeah', null, 'Zips'));
    expect(await screen.findByText('home')).toBeTruthy();
  });

  it('sends the password when the league needs one', async () => {
    at('/leagues/new');
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'Locked' } });
    fireEvent.change(screen.getByLabelText('Your team name'), { target: { value: 'Zips' } });
    fireEvent.click(screen.getByLabelText('Needs a password to join'));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));
    await waitFor(() => expect(api.createMyLeague).toHaveBeenCalledWith('Locked', 'secret1', 'Zips'));
  });
});

describe('a password of only spaces (review fix)', () => {
  it('is refused on Create instead of quietly making a public league', async () => {
    at('/leagues/new');
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'Locked' } });
    fireEvent.change(screen.getByLabelText('Your team name'), { target: { value: 'Zips' } });
    fireEvent.click(screen.getByLabelText('Needs a password to join'));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: '      ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create league' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/4–40 characters/);
    expect(api.createMyLeague).not.toHaveBeenCalled();
  });

  it('is refused on Change password instead of quietly removing the password', async () => {
    render(<ManageLeague league={league({ has_password: true, is_creator: true })} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: '      ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password', hidden: true }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/4–40 characters/);
    expect(api.setLeaguePassword).not.toHaveBeenCalled();
  });
});

describe('ManageLeague (t215)', () => {
  it('deletes only while yours is the only team, after a confirm', async () => {
    const onChanged = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { rerender } = render(<ManageLeague league={league({ teams: 1, is_creator: true })} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete league', hidden: true }));
    await waitFor(() => expect(api.deleteLeague).toHaveBeenCalledWith('l1'));
    expect(onChanged).toHaveBeenCalled();
    rerender(<ManageLeague league={league({ teams: 2, is_creator: true })} onChanged={onChanged} />);
    expect(screen.queryByRole('button', { name: 'Delete league', hidden: true })).toBeNull();
    expect(screen.getByText(/only an admin can delete/i)).toBeTruthy();
  });

  it('renames, and removes the password only when there is one', async () => {
    render(<ManageLeague league={league({ has_password: true, is_creator: true })} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('League name'), { target: { value: 'Huck No' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename league', hidden: true }));
    await waitFor(() => expect(api.renameLeague).toHaveBeenCalledWith('l1', 'Huck No'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove password', hidden: true }));
    await waitFor(() => expect(api.setLeaguePassword).toHaveBeenCalledWith('l1', null));
    cleanup();
    render(<ManageLeague league={league({ is_creator: true })} onChanged={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Remove password', hidden: true })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add password', hidden: true })).toBeTruthy();
  });
});

describe('LeagueLeave (t217)', () => {
  it('leaves only after the confirm, then tells Home', async () => {
    vi.mocked(api.listLeagues).mockResolvedValue([league({ teams: 3 })]);
    const onLeft = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<LeagueLeave membershipId="m1" league={league({ teams: 3 })} onLeft={onLeft} />);
    const button = screen.getByRole('button', { name: 'Leave Huck Yeah' });
    fireEvent.click(button);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(api.leaveLeague).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(api.leaveLeague).toHaveBeenCalledWith('m1'));
    expect(onLeft).toHaveBeenCalled();
    expect(confirm.mock.calls[0][0]).not.toMatch(/deleted too/);
  });

  it('warns that the league goes too when yours is its only team, counting teams afresh', async () => {
    // Home loaded 3 teams, but the others have left since.
    vi.mocked(api.listLeagues).mockResolvedValue([league({ teams: 1 })]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<LeagueLeave membershipId="m1" league={league({ teams: 3 })} onLeft={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave Huck Yeah' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toMatch(/Huck Yeah will be deleted too/);
  });

  it('is not offered once the team has donated (leaving can never succeed then)', () => {
    render(<LeagueLeave membershipId="m1" league={league({})} donated onLeft={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Leave Huck Yeah' })).toBeNull();
  });

  it('explains a refusal in place', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.leaveLeague).mockRejectedValueOnce({ message: 'TEAM_HAS_BIDS' });
    const onLeft = vi.fn();
    render(<LeagueLeave membershipId="m1" league={league({})} onLeft={onLeft} />);
    fireEvent.click(screen.getByRole('button', { name: 'Leave Huck Yeah' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/bid/);
    expect(onLeft).not.toHaveBeenCalled();
  });
});
