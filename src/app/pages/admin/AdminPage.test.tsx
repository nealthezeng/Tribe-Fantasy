// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from './AdminPage';

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ seasons: [] as Row[], stages: [] as Row[], games: [] as Row[], sessions: [] as Row[] }));

vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: true, loading: false }) }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder = {
        select: () => builder, eq: () => builder, in: () => builder, order: () => builder,
        then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: [...(db as Record<string, Row[]>)[table]], error: null }),
      };
      return builder;
    },
  },
}));
vi.mock('../../lib/rpc', () => ({ api: {
  deleteSeason: vi.fn((id: string) => { db.seasons = db.seasons.filter((s) => s.id !== id); return Promise.resolve(); }),
  renameSeason: vi.fn(), createSeason: vi.fn(),
} }));
// Each panel is its own tested component: here they only say what they were given.
vi.mock('./StagesPanel', () => ({ StagesPanel: ({ seasonId }: { seasonId: string }) => <p>Stages of {seasonId}</p> }));
vi.mock('./LeaguesPanel', () => ({ LeaguesPanel: ({ seasonId }: { seasonId: string }) => <p>Leagues of {seasonId}</p> }));
vi.mock('./WalletsPanel', () => ({ WalletsPanel: ({ seasonId }: { seasonId: string }) => <p>Wallets of {seasonId}</p> }));
vi.mock('./AthletesPanel', () => ({ AthletesPanel: ({ seasonId }: { seasonId: string }) => <p>Players of {seasonId}</p> }));
vi.mock('./SettingsEditor', () => ({ SettingsEditor: ({ seasonId }: { seasonId: string }) => <p>Settings of {seasonId}</p> }));
vi.mock('./BackupPanel', () => ({ BackupPanel: ({ seasonId }: { seasonId: string }) => <p>Backup of {seasonId}</p> }));
vi.mock('./UsersPanel', () => ({ UsersPanel: () => <p>Accounts list</p> }));
vi.mock('./HistoryPanel', () => ({ HistoryPanel: () => <p>History list</p> }));

const SEASONS = [{ id: 's2', name: 'Spring 2027', status: 'setup' }, { id: 's1', name: 'Fall 2026', status: 'live' }]; // newest first
const Search = () => <output data-testid="search">{useLocation().search}</output>;
const show = (entry = '/admin') => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes><Route path="/admin" element={<><AdminPage /><Search /></>} /></Routes>
  </MemoryRouter>,
);
const chips = () => within(screen.getByRole('navigation', { name: 'Admin sections' })).getAllByRole('button');
const pressed = () => chips().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

beforeEach(() => {
  db.seasons = [...SEASONS];
  db.stages = [];
  db.games = [];
  db.sessions = [];
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  scrolled(0);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
const scrolled = (y: number) => Object.defineProperty(window, 'scrollY', { configurable: true, value: y });

describe('AdminPage (P9 ruling 17)', () => {
  it('shows four group chips and manages the newest season without opening More', async () => {
    show();
    expect(await screen.findByText('Stages of s2')).toBeTruthy();
    expect(chips().map((b) => b.textContent)).toEqual(['Tournaments', 'Teams', 'People', 'More']);
    expect(pressed()).toEqual(['Tournaments']);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Admin Spring 2027');
    expect(screen.queryByText('Seasons')).toBeNull(); // the Seasons panel isn't mounted
    expect(screen.queryAllByRole('navigation')).toHaveLength(1); // one section: no sub-tabs
  });

  it('opens Teams › Wallets from ?tab=wallets', async () => {
    show('/admin?tab=wallets');
    expect(await screen.findByText('Wallets of s2')).toBeTruthy();
    expect(pressed()).toEqual(['Teams']);
    const tabs = within(screen.getByRole('navigation', { name: 'Teams' }));
    expect(tabs.getByRole('link', { name: 'Wallets' }).getAttribute('aria-current')).toBe('page');
    expect(tabs.getByRole('link', { name: 'Leagues' }).getAttribute('aria-current')).toBeNull();
  });

  it('writes the tab into the address', async () => {
    show();
    await screen.findByText('Stages of s2');
    fireEvent.click(screen.getByRole('button', { name: 'People' }));
    expect(screen.getByTestId('search').textContent).toBe('?tab=users');
    expect(screen.getByText('Accounts list')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Players' }));
    expect(screen.getByTestId('search').textContent).toBe('?tab=athletes');
    expect(screen.getByText('Players of s2')).toBeTruthy();
    expect(pressed()).toEqual(['People']);
  });

  it("keeps each tab's scroll for the visit", async () => {
    show();
    await screen.findByText('Stages of s2');
    scrolled(500);
    fireEvent.click(screen.getByRole('button', { name: 'Teams' }));
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0); // a tab not seen yet opens at its top
    scrolled(0);
    fireEvent.click(screen.getByRole('button', { name: 'Tournaments' }));
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 500);
  });

  it('follows a loading tab back to its saved spot until it gets there, or until the admin scrolls', async () => {
    const disconnect = vi.fn();
    let grew = () => {};
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { grew = cb; } observe() {} disconnect = disconnect; });
    show();
    await screen.findByText('Stages of s2');
    const away = () => { scrolled(500); fireEvent.click(screen.getByRole('button', { name: 'Teams' })); scrolled(0); };
    away();
    fireEvent.click(screen.getByRole('button', { name: 'Tournaments' })); // the page is too short for 500 yet
    grew();
    expect(disconnect).not.toHaveBeenCalled();
    scrolled(500);
    grew();
    expect(disconnect).toHaveBeenCalledTimes(1);
    away();
    disconnect.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Tournaments' }));
    fireEvent.wheel(window);
    expect(disconnect).toHaveBeenCalledTimes(1);
    away();
    disconnect.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Tournaments' }));
    fireEvent.pointerDown(window); // a mouse press (opening a row, dragging the scrollbar) stops it too
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('manages the season picked in More › Season, and the newest again once the picked one is deleted', async () => {
    show('/admin?tab=season');
    fireEvent.click(within((await screen.findByText('Fall 2026')).closest('li')!).getByRole('button', { name: 'Manage' }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Admin Fall 2026');
    fireEvent.change(screen.getByLabelText('Type Fall 2026 to confirm'), { target: { value: 'Fall 2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete season', hidden: true }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Admin Spring 2027'));
    expect(screen.queryByText('Fall 2026')).toBeNull();
  });
});

describe('the stuck-game warning (P9 ruling 18)', () => {
  it('warns about a game still live after its tournament ended, linking to its page', async () => {
    db.stages = [{ id: 'fe', name: 'Feasterns', ends_on: '2020-10-09' }];
    db.games = [{ id: 'g4', stage_id: 'fe', number: 4, session_id: 'ses4', started_at: '2020-10-09T14:00:00Z', finished_at: null, opponent: null }];
    db.sessions = [{ id: 'ses4', verified_at: null }];
    show('/admin?tab=users'); // on every tab
    const link = await screen.findByRole('link', { name: 'Open Feasterns game 4' });
    expect(link.getAttribute('href')).toBe('/stats/ses4');
    expect(link.closest('.notice')!.textContent).toContain("Feasterns game 4 is still live. Later results won't count until it's verified.");
  });
});

describe('with no season', () => {
  it('points to More › Season, and Accounts, History and Season still work', async () => {
    db.seasons = [];
    show();
    expect((await screen.findByText(/Create a season in/)).textContent).toBe('Create a season in More › Season.');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Admin');
    fireEvent.click(screen.getByRole('button', { name: 'People' }));
    expect(screen.getByText('Accounts list')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('link', { name: 'History' }));
    expect(screen.getByText('History list')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Season' }));
    expect(screen.getByText('None yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create season' })).toBeTruthy();
  });
});
