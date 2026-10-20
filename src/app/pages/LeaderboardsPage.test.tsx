// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { HashRouter, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLeagueTournament, type OverallStanding, type TournamentRows } from '../lib/tournament';
import type { MembershipRow } from './HomePage';
import { LeaderboardsPage } from './LeaderboardsPage';

const rows = vi.hoisted(() => ({ current: null as unknown as TournamentRows }));
const overall = vi.hoisted(() => ({ current: [] as OverallStanding[], leagues: 1 }));
const myTeams = vi.hoisted(() => ({ current: [] as MembershipRow[] }));
const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: auth.signedIn ? { user: { id: 'u1' } } : null, loading: false }),
}));
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadLeagueTournament: () => Promise.resolve(buildLeagueTournament(rows.current, Date.parse('2026-11-07T16:30:00Z'))),
  loadSeasonStandings: () => Promise.resolve(overall.current),
  countLeagues: () => Promise.resolve(overall.leagues),
  loadNeedsYou: () => Promise.resolve(false),
}));
vi.mock('./HomePage', async (orig) => ({
  ...(await orig<typeof import('./HomePage')>()),
  loadMyTeams: () => Promise.resolve(myTeams.current),
}));

// The closed shares card under the standings reads its stage and members from here.
vi.mock('../lib/supabase', () => {
  const tables: Record<string, unknown[]> = {
    get stages() { return rows.current.stages; },
    get memberships() { return rows.current.members; },
    seasons: [{ settings: {} }],
  };
  const from = (name: string) => {
    const data = tables[name] ?? [];
    const q = {
      select: () => q, eq: () => q, is: () => q, not: () => q, order: () => q,
      single: () => Promise.resolve({ data: data[0], error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data, error: null }),
    };
    return q;
  };
  return { supabase: { from } };
});

const team = (id: string, team_name: string, league: string): MembershipRow => ({
  id, team_name, league_id: `L-${id}`, created_at: '2026-10-01T00:00:00Z', donation_code: 'X', credit_ledger: [],
  leagues: { name: league, season_id: 'se', seasons: { name: 'Spring', settings: {} } },
});
/** Two teams before the tournament opens; the owners are named by `profiles`. */
const base = (): TournamentRows => ({
  settings: {},
  stages: [{ id: 'S1', name: 'Fall beta', starts_on: '2026-10-19', ends_on: '2026-11-08', bid_close_at: '2026-11-03T00:00:00Z', auction_seed: null,
    auction_run_at: '2026-11-04T00:00:00Z' }],
  games: [],
  pairings: [],
  members: [{ id: 'm1', team_name: 'Zeal', created_at: '2026-10-01T00:00:00Z', removed_at: null, user_id: 'u1' },
    { id: 'm2', team_name: 'Flow', created_at: '2026-10-01T00:00:00Z', removed_at: null, user_id: 'u2' }],
  profiles: [{ id: 'u1', display_name: 'Neal Zeng' }, { id: 'u2', display_name: 'Sam Sample' }],
  slots: [], picks: [], sessions: [], lines: [], taps: [], injuries: [], athletes: [],
});

afterEach(() => { cleanup(); localStorage.clear(); overall.leagues = 1; auth.signedIn = true; });
beforeEach(() => {
  rows.current = base();
  myTeams.current = [team('m1', 'Zeal', 'League A')];
});
const show = () => render(<MemoryRouter><LeaderboardsPage /></MemoryRouter>);
const standings = async () => within(await screen.findByRole('article', { name: 'Standings' }));

describe('LeaderboardsPage', () => {
  it("shows the chosen team's league standings with each owner beside the record", async () => {
    show();
    const row = (await screen.findByText('Zeal (you)')).closest('li')!;
    expect(row.querySelector('small')?.textContent).toBe('Neal Zeng · 0–0');
    expect((await standings()).getByText('Flow').closest('li')?.querySelector('small')?.textContent).toBe('Sam Sample · 0–0');
  });

  it('shows just the record when an owner has no name (no stray separator)', async () => {
    rows.current = { ...base(), profiles: [] };
    show();
    const row = (await screen.findByText('Zeal (you)')).closest('li')!;
    expect(row.querySelector('small')?.textContent).toBe('0–0');
  });

  it('follows the remembered team choice, with a switch for 2+ teams', async () => {
    myTeams.current = [team('m1', 'Zeal', 'League A'), team('m2', 'Flow', 'League B')];
    localStorage.setItem('league-team', 'm2');
    show();
    const group = await screen.findByRole('group', { name: 'League' });
    expect(within(group).getByRole('button', { name: 'League B' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'League A' }));
    expect(localStorage.getItem('league-team')).toBe('m1');
  });

  it('tells a signed-in user with no team to join a league', async () => {
    myTeams.current = [];
    render(<HashRouter><LeaderboardsPage /></HashRouter>);
    expect((await screen.findByRole('link', { name: 'Join a league' })).getAttribute('href')).toBe('#/leagues');
  });

  it('sends a signed-out visitor to sign in', () => {
    auth.signedIn = false;
    render(<MemoryRouter><Routes><Route index element={<LeaderboardsPage />} /><Route path="login" element={<p>sign in page</p>} /></Routes></MemoryRouter>);
    expect(screen.getByText('sign in page')).toBeTruthy();
  });

  it('shows the closed shares card below the standings', async () => {
    show();
    const every = await screen.findByText('Every team');
    const article = await screen.findByRole('article', { name: 'Standings' });
    expect(article.compareDocumentPosition(every) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps showing the standings between tournaments (T4)', async () => {
    rows.current = { ...base(), stages: [{ ...base().stages[0], auction_run_at: null }] };
    show();
    expect((await standings()).getByText('Flow')).toBeTruthy();
  });
});

describe('Standings toggle (t226)', () => {
  const row = (membershipId: string, team: string, league: string, place: number, tied = false, owner = ''): OverallStanding =>
    ({ membershipId, team, owner, league, points: 10 - place, totalScore: 0, wins: 2, losses: 1, ties: 0, place, tied });
  const items = async () => (await standings()).getAllByRole('listitem');
  const allLeagues = async () => fireEvent.click(await screen.findByRole('button', { name: 'All leagues' }));

  it('has no toggle while the season has one league', async () => {
    show();
    await standings();
    expect(screen.queryByRole('button', { name: 'All leagues' })).toBeNull();
  });

  it('switches to every team of the season, with leagues and owners, and back', async () => {
    overall.leagues = 2;
    overall.current = [row('b1', 'Flow', 'League B', 1, false, 'Sam Sample'), row('m1', 'Zeal', 'League A', 2, true), row('b2', 'Huck', 'League B', 2, true)];
    show();
    await allLeagues();
    await waitFor(async () => expect(await items()).toHaveLength(3));
    expect((await items()).map((li) => li.textContent)).toEqual([
      '1FlowLeague B · Sam Sample · 2–19 points', 'T2Zeal (you)League A · 2–18 points', 'T2HuckLeague B · 2–18 points']);
    expect(document.querySelector('.ranks [aria-current]')?.textContent).toContain('Zeal');
    fireEvent.click(screen.getByRole('button', { name: 'League A' }));
    expect(await items()).toHaveLength(2);
  });

  it('shows a long list as the top 5 and your row, then all of it on request', async () => {
    overall.leagues = 2;
    overall.current = [...'abcdefghijk'.split('').map((c, i) => row(c, `Team ${c}`, 'League B', i + 1)), row('m1', 'Zeal', 'League A', 12)];
    show();
    await allLeagues();
    await waitFor(async () => expect((await standings()).getByText(/Zeal/)).toBeTruthy());
    expect(await items()).toHaveLength(7); // 5, the gap ('6 more teams'), yours
    expect((await standings()).getByText('6 more teams')).toBeTruthy();
    fireEvent.click((await standings()).getByRole('button', { name: 'Show all 12 teams' }));
    expect(await items()).toHaveLength(12);
  });

  it('never cuts inside a tie, and is a leaderboard before any game counts (t239)', async () => {
    overall.leagues = 2;
    overall.current = [...'abcdefghi'.split('').map((c) => row(c, `Team ${c}`, 'League B', 1, true)), row('m1', 'Zeal', 'League A', 10)];
    show();
    await allLeagues();
    await waitFor(async () => expect(await items()).toHaveLength(10)); // all tied with 5th: no cut
    cleanup();
    overall.current = [{ ...row('m1', 'Zeal', 'League A', 1, true), wins: 0, losses: 0 }, { ...row('b1', 'Flow', 'League B', 1, true), wins: 0, losses: 0 }];
    show();
    await allLeagues();
    await waitFor(async () => expect((await items()).map((li) => li.textContent)).toEqual([
      'T1Zeal (you)League A · 0–0', 'T1FlowLeague B · 0–0'].map((t) => expect.stringContaining(t))));
  });
});
