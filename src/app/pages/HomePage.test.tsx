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
  loadTeamStatus: (id: string) => Promise.resolve(id === 'b' ? ['2 of 6', 'No pick for game 3'] : []),
}));
vi.mock('../lib/rpc', () => ({ api: { listLeagues: () => Promise.resolve([]) } }));
// The team itself (matchup, auction, standings) has its own tests.
vi.mock('./TournamentCard', () => ({ TournamentCard: ({ teamName }: { teamName: string }) => <h2>{teamName}</h2> }));

afterEach(() => { cleanup(); localStorage.clear(); });
const show = () => render(<MemoryRouter><HomePage /></MemoryRouter>);
const switcher = () => within(screen.getByRole('group', { name: 'Team' }));

describe('HomePage with several teams (t229, t240, t241)', () => {
  it("lists only this season's teams, and a line per other team that switches to it", async () => {
    localStorage.setItem('league-team', 'old'); // saved last season: falls back to the first current team
    show();
    await screen.findByRole('group', { name: 'Team' });
    expect(switcher().getAllByRole('button').map((b) => b.textContent)).toEqual(['Zeal', 'Flow']);
    expect(switcher().getByRole('button', { name: 'Zeal' }).getAttribute('aria-pressed')).toBe('true');
    const others = within(screen.getByRole('list', { name: 'Your other teams' }));
    await waitFor(() => expect(others.getByRole('listitem').textContent).toBe('Flow2 of 6 · No pick for game 3'));
    fireEvent.click(others.getByRole('button', { name: 'Flow' }));
    expect(switcher().getByRole('button', { name: 'Flow' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Flow' })).toBeTruthy();
    expect(localStorage.getItem('league-team')).toBe('b');
  });
});

describe('CreditsPage with several teams', () => {
  it('shows the team chosen on the League tab, and switching here switches there too', async () => {
    localStorage.setItem('league-team', 'b');
    render(<MemoryRouter><CreditsPage /></MemoryRouter>);
    expect(await screen.findByRole('article', { name: 'Flow' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Zeal' })).toBeNull();
    fireEvent.click(switcher().getByRole('button', { name: 'Zeal' }));
    expect(screen.getByRole('article', { name: 'Zeal' })).toBeTruthy();
    expect(localStorage.getItem('league-team')).toBe('a');
  });
});
