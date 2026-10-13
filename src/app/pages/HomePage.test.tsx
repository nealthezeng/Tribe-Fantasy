// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditsPage } from './Credits';
import { HomePage } from './HomePage';

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false, isAdmin: false }),
}));
const team = vi.hoisted(() => (id: string, team_name: string, season_id: string) => ({
  id, team_name, league_id: `L-${id}`, created_at: '2026-10-01T00:00:00Z', donation_code: 'BKRT', credit_ledger: [],
  leagues: { name: `League ${id}`, season_id, seasons: { name: season_id, settings: {} } },
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
vi.mock('../lib/rpc', () => ({ api: { listLeagues: () => Promise.resolve([]), donationLeaderboard: () => Promise.resolve([]) } }));
// The team itself (matchup, auction, standings) has its own tests.
vi.mock('./TournamentCard', () => ({ TournamentCard: ({ teamName }: { teamName: string }) => <h2>{teamName}</h2> }));

afterEach(() => { cleanup(); localStorage.clear(); });
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

describe('TeamSwitch mouse wheel', () => {
  it('scrolls across the leagues, and lets the page scroll once at the end', async () => {
    show();
    const group = await screen.findByRole('group', { name: 'League' });
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
    fireEvent.click(switcher().getByRole('button', { name: 'League a' }));
    expect(screen.getByRole('article', { name: 'Zeal' })).toBeTruthy();
    expect(localStorage.getItem('league-team')).toBe('a');
  });
});
