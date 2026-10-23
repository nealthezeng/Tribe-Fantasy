// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HashRouter, MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditsPage } from './Credits';
import { api } from '../lib/rpc';
import { loadCurrentGame } from '../lib/tournament';
import { HomePage } from './HomePage';

const auth = vi.hoisted(() => ({ signedIn: true, isKeeper: false }));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: auth.signedIn ? { user: { id: 'u1' } } : null, loading: false, isAdmin: false, isKeeper: auth.isKeeper }),
}));
const season = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, loaded: {} as Record<string, unknown> }));
const team = vi.hoisted(() => (id: string, team_name: string, season_id: string) => ({
  id, team_name, league_id: `L-${id}`, created_at: '2026-10-01T00:00:00Z', donation_code: 'BKRT', credit_ledger: [],
  leagues: { name: `League ${id}`, season_id, seasons: { name: season_id, get settings() { return season.settings; } } },
}));
vi.mock('../lib/supabase', () => {
  const rows = [team('old', 'Last Fall', 'fall'), team('a', 'Zeal', 'spring'), team('b', 'Flow', 'spring')];
  const q = { select: () => q, eq: () => q, order: () => Promise.resolve({ data: rows, error: null }) };
  return { supabase: { from: () => q } };
});
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve({ id: 'spring', name: 'Spring', get settings() { return season.loaded; } }),
}));
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadNeedsYou: (id: string) => Promise.resolve(id === 'b'),
  loadCurrentGame: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../lib/rpc', () => ({ api: { listLeagues: () => Promise.resolve([]), donationLeaderboard: () => Promise.resolve([]),
  myDonateAnonymously: () => Promise.resolve(false), renameMyTeam: vi.fn() } }));
// The team itself (matchup, auction, standings) has its own tests.
vi.mock('./TournamentCard', () => ({ TournamentCard: ({ teamName }: { teamName: string }) => <h2>{teamName}</h2> }));

beforeEach(() => localStorage.setItem('tribe.guide.u1', '1')); // the guide has its own tests below
afterEach(() => {
  cleanup(); localStorage.clear(); season.settings = {}; season.loaded = {}; vi.restoreAllMocks();
  auth.signedIn = true; auth.isKeeper = false; vi.mocked(loadCurrentGame).mockClear().mockResolvedValue(null);
});
const show = () => render(<MemoryRouter><HomePage /></MemoryRouter>);
/** This user has no team this season (restored after each test). */
const noTeams = async () => {
  const { supabase } = await import('../lib/supabase');
  const q = { select: () => q, eq: () => q, order: () => Promise.resolve({ data: [], error: null }) };
  vi.spyOn(supabase!, 'from').mockReturnValue(q as never);
};
const switcher = () => within(screen.getByRole('group', { name: 'League' }));

describe('HomePage with several teams (t229, t240)', () => {
  it("names this season's teams by league, dots the one that needs you, and switches", async () => {
    localStorage.setItem('league-team', 'old'); // saved last season: falls back to the first current team
    show();
    await screen.findByRole('group', { name: 'League' });
    expect(switcher().getAllByRole('button').map((b) => b.textContent)).toEqual(['League a', 'League b']);
    expect(switcher().getByRole('button', { name: 'League a' }).getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(switcher().getAllByRole('button').map((b) => b.textContent)).toEqual(['League a', 'League b (needs you)']));
    fireEvent.click(switcher().getByRole('button', { name: /League b/ }));
    expect(switcher().getByRole('button', { name: /League b/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Flow' })).toBeTruthy();
    expect(localStorage.getItem('league-team')).toBe('b');
  });
});

describe('Rename your team from League settings (t311)', () => {
  // listLeagues is [] here, so there is no listing: no manage or leave, and the rename form must still show.
  const open = async () => { show(); fireEvent.click(await screen.findByText('League settings')); };
  const rename = (v: string) => {
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: v } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
  };
  beforeEach(() => vi.mocked(api.renameMyTeam).mockReset().mockResolvedValue(undefined));

  it('renames the chosen team, trimmed; unchanged or blank is not offered', async () => {
    await open();
    const button = screen.getByRole('button', { name: 'Rename' }) as HTMLButtonElement;
    expect((screen.getByLabelText('Team name') as HTMLInputElement).value).toBe('Zeal');
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: '  ' } });
    expect(button.disabled).toBe(true);
    rename(' Spark ');
    await waitFor(() => expect(api.renameMyTeam).toHaveBeenCalledWith('a', 'Spark'));
  });

  it('shows a taken name as an error and keeps the form', async () => {
    vi.mocked(api.renameMyTeam).mockRejectedValueOnce({ message: 'TEAM_NAME_TAKEN' });
    await open();
    rename('Flow');
    expect((await screen.findByRole('alert')).textContent).toBe('Another team in this league already has that name.');
    expect((screen.getByLabelText('Team name') as HTMLInputElement).value).toBe('Flow');
  });
});

describe('TeamSwitch edge glow', () => {
  it('lights the edge a team that needs you is hidden past, and only that edge', async () => {
    // jsdom has no layout: the switch is 0–300px wide and every dot sits at 500px, past its right edge.
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return (this.classList.contains('needs') ? { left: 500, right: 508 } : { left: 0, right: 300 }) as DOMRect;
    });
    show();
    const group = await screen.findByRole('group', { name: 'League' });
    await waitFor(() => expect(group.parentElement!.className).toBe('team-switch-wrap glow-right'));
    spy.mockRestore();
  });
});

describe('TeamSwitch scrolls to a team that needs you (t303)', () => {
  // jsdom has no layout or scrollIntoView: the switch is 0–300px wide and every dot sits at 500px, past its right edge.
  const layout = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return (this.classList.contains('needs') ? { left: 500, right: 508 } : { left: 0, right: 300 }) as DOMRect;
  });
  const scrollSpy = vi.fn();
  beforeEach(() => { scrollSpy.mockClear(); HTMLElement.prototype.scrollIntoView = scrollSpy; layout(); });
  afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView'); });

  it('scrolls the needing team into view when the chosen one does not need you', async () => {
    show();
    await screen.findByRole('group', { name: 'League' });
    await waitFor(() => expect(switcher().getAllByRole('button').map((b) => b.textContent)).toEqual(['League a', 'League b (needs you)']));
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' }));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy.mock.contexts[0]).toBe(switcher().getByRole('button', { name: /League b/ }));
  });

  it('leaves the switch alone when the chosen team is the one that needs you', async () => {
    localStorage.setItem('league-team', 'b');
    show();
    await screen.findByRole('group', { name: 'League' });
    await waitFor(() => expect(switcher().getAllByRole('button').map((b) => b.textContent)).toEqual(['League a', 'League b (needs you)']));
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});

describe('TeamSwitch mouse wheel', () => {
  it('scrolls across the leagues, and lets the page scroll once at the end', async () => {
    show();
    const group = await screen.findByRole('group', { name: 'League' });
    // The switch commits before the passive effect that adds its wheel listener; flush it, or a loaded machine spins first.
    await act(async () => {});
    Object.defineProperties(group, { scrollWidth: { value: 600 }, clientWidth: { value: 300 } }); // jsdom has no layout
    const spin = (deltaY: number) => {
      const e = new WheelEvent('wheel', { deltaY, cancelable: true });
      group.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(spin(100)).toBe(true);
    expect(group.scrollLeft).toBe(100);
    group.scrollLeft = 300;
    expect(spin(100)).toBe(false); // at the end: the page scrolls instead
    expect(spin(-100)).toBe(true);
    expect(group.scrollLeft).toBe(200);
  });
});

describe('CreditsPage with several teams', () => {
  it('shows the team chosen on the League tab, and switching here switches there too', async () => {
    localStorage.setItem('league-team', 'b');
    render(<MemoryRouter><CreditsPage /></MemoryRouter>);
    expect(await screen.findByRole('article', { name: 'Flow' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Zeal' })).toBeNull();
    // The season takes no donations ({} settings), so no Donors card.
    expect(screen.queryByRole('article', { name: 'Donors' })).toBeNull();
    fireEvent.click(switcher().getByRole('button', { name: 'League a' }));
    expect(screen.getByRole('article', { name: 'Zeal' })).toBeTruthy();
    expect(localStorage.getItem('league-team')).toBe('a');
  });

  it('shows the Donors card while the season takes donations', async () => {
    season.settings = { donations_enabled: true, venmo_handle: 'tribe-fund' };
    render(<MemoryRouter><CreditsPage /></MemoryRouter>);
    expect(await screen.findByRole('article', { name: 'Donors' })).toBeTruthy();
  });
});

describe('First-visit guide on League (t320)', () => {
  beforeEach(() => localStorage.clear());
  it('shows the guide above the Get started card for a new user, and Got it lands on the page heading', async () => {
    await noTeams();
    show();
    const guide = await screen.findByRole('complementary', { name: 'How it works' });
    const started = await screen.findByRole('heading', { name: 'Get started' });
    expect(guide.compareDocumentPosition(started) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Your teams' }));
  });

  it('uses the season pick count', async () => {
    season.loaded = { picks_per_game: 3 };
    show();
    await screen.findByText(/Pick 3 each game/);
  });
});

describe('League for a keeper (P9 ruling 11)', () => {
  const current = (started: boolean) => ({
    stage: { id: 'S1', name: 'CCCs' }, games: [], count: 3,
    game: { id: 'g2', stage_id: 'S1', number: 2, opponent: 'UNC', session_id: started ? 's2' : null,
      started_at: started ? '2026-10-22T14:00:00Z' : null, finished_at: null },
  }) as never;
  beforeEach(() => { auth.isKeeper = true; });

  it('shows a keeper the live game with a gold Tally button when they have no team', async () => {
    vi.mocked(loadCurrentGame).mockResolvedValue(current(true));
    await noTeams();
    render(<HashRouter><HomePage /></HashRouter>);
    const tally = await screen.findByRole('link', { name: 'Tally game 2' });
    expect(tally.className).toBe('button');
    expect(tally.getAttribute('href')).toBe('#/tally?game=s2');
    expect(screen.getByText('CCCs · Game 2 vs UNC')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
    expect(loadCurrentGame).toHaveBeenCalledWith('spring'); // the current season
    // No team: a quiet line instead of the Get started card, so Tally stays the one gold button.
    expect(await screen.findByText("You don't have a team this season.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Join a league' }).className).toBe('more');
    expect(screen.queryByRole('heading', { name: 'Get started' })).toBeNull();
  });

  it('gives a keeper with a team a quiet Tally link', async () => {
    vi.mocked(loadCurrentGame).mockResolvedValue(current(true));
    show();
    expect((await screen.findByRole('link', { name: 'Tally game 2' })).className).toBe('more');
    expect(screen.queryByText("You don't have a team this season.")).toBeNull();
  });

  it('shows no game card while the game has not started', async () => {
    vi.mocked(loadCurrentGame).mockResolvedValue(current(false));
    show();
    await screen.findByRole('heading', { name: 'Zeal' });
    await waitFor(() => expect(loadCurrentGame).toHaveBeenCalled());
    await act(async () => {}); // let the load land
    expect(screen.queryByRole('link', { name: /Tally/ })).toBeNull();
  });
});

describe('Landing (signed out)', () => {
  it('says playing is free on the landing', () => {
    auth.signedIn = false;
    show();
    expect(screen.getByText(/Free to play\. Donations go to the team fund\./)).toBeTruthy();
  });
});
