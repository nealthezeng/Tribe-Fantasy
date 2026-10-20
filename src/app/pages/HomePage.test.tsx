// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreditsPage } from './Credits';
import { api } from '../lib/rpc';
import { HomePage } from './HomePage';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false, isAdmin: false }),
}));
const season = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }));
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
  loadCurrentSeason: () => Promise.resolve({ id: 'spring', name: 'Spring', settings: {} }),
}));
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadNeedsYou: (id: string) => Promise.resolve(id === 'b'),
}));
vi.mock('../lib/rpc', () => ({ api: { listLeagues: () => Promise.resolve([]), donationLeaderboard: () => Promise.resolve([]),
  myDonateAnonymously: () => Promise.resolve(false), renameMyTeam: vi.fn() } }));
// The team itself (matchup, auction, standings) has its own tests.
vi.mock('./TournamentCard', () => ({ TournamentCard: ({ teamName }: { teamName: string }) => <h2>{teamName}</h2> }));

afterEach(() => { cleanup(); localStorage.clear(); season.settings = {}; });
const show = () => render(<MemoryRouter><HomePage /></MemoryRouter>);
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
