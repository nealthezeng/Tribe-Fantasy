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
  slots: [], picks: [], sessions: [], lines: [], taps: [], injuries: [], outs: [], athletes: [],
});

afterEach(() => { cleanup(); localStorage.clear(); overall.leagues = 1; auth.signedIn = true; });
beforeEach(() => {
  rows.current = counted();
  myTeams.current = [team('m1', 'Zeal', 'League A')];
});
/** One final game already counted (a 0–0 tie): the standings are real from here. */
const counted = (): TournamentRows => ({
  ...base(),
  games: [{ id: 'g1', stage_id: 'S1', number: 1, session_id: 'p1', started_at: '2026-10-20T14:00:00Z', finished_at: '2026-10-20T15:00:00Z', opponent: null },
    { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null, opponent: null }], // keeps S1 the tournament being played
  pairings: [{ game_id: 'g1', home: 'm1', away: 'm2' }, { game_id: 'g2', home: 'm1', away: 'm2' }],
  sessions: [{ id: 'p1', verified_at: '2026-10-20T20:00:00Z' }],
});
const show = () => render(<MemoryRouter><LeaderboardsPage /></MemoryRouter>);
const standings = async () => within(await screen.findByRole('article', { name: 'Standings' }));

describe('LeaderboardsPage', () => {
  it('hides the standings until a game counts', async () => {
    rows.current = base();
    overall.leagues = 2;
    const { container } = show();
    expect(await screen.findByText('Standings start after the first game.')).toBeTruthy();
    expect(container.querySelector('.ranks')).toBeNull();
    expect(screen.queryByRole('button', { name: 'All leagues' })).toBeNull();
  });

  it('shows the standings once a game counts', async () => {
    show();
    await standings();
    expect(await screen.findByText('Zeal (you)')).toBeTruthy();
    expect(document.querySelectorAll('.ranks li').length).toBe(2);
    expect(screen.queryByText('Standings start after the first game.')).toBeNull();
  });

  it('explains how the table is ordered', async () => {
    show();
    const card = await standings();
    const help = card.getByRole('button', { name: 'How the table is ordered' });
    expect(help.previousElementSibling?.textContent).toBe('Standings'); // beside the heading
    cleanup();
    rows.current = base(); // before a game counts: no table, so nothing to explain
    show();
    await screen.findByText('Standings start after the first game.');
    expect(screen.queryByRole('button', { name: 'How the table is ordered' })).toBeNull();
  });

  it("shows the chosen team's league standings with each owner beside the record", async () => {
    show();
    const row = (await screen.findByText('Zeal (you)')).closest('li')!;
    expect(row.querySelector('small')?.textContent).toBe('Neal Zeng · 0–0–1');
    expect((await standings()).getByText('Flow').closest('li')?.querySelector('small')?.textContent).toBe('Sam Sample · 0–0–1');
  });

  it('shows just the record when an owner has no name (no stray separator)', async () => {
    rows.current = { ...counted(), profiles: [] };
    show();
    const row = (await screen.findByText('Zeal (you)')).closest('li')!;
    expect(row.querySelector('small')?.textContent).toBe('0–0–1');
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

  it('has no shares card any more', async () => {
    show();
    await standings();
    expect(screen.queryByText('Every team')).toBeNull();
    expect(screen.queryByText(/shares/i)).toBeNull();
  });

  it('keeps showing the standings between tournaments (T4)', async () => {
    rows.current = { ...counted(), stages: [{ ...base().stages[0], auction_run_at: null }] };
    show();
    expect((await standings()).getByText('Flow')).toBeTruthy();
  });
});

describe('team links', () => {
  it("links team names to their pages; in All leagues only your league's rows", async () => {
    render(<HashRouter><LeaderboardsPage /></HashRouter>);
    expect((await screen.findByRole('link', { name: 'Flow' })).getAttribute('href')).toBe('#/team/m2');
    expect(screen.getByRole('link', { name: 'Zeal (you)' }).getAttribute('href')).toBe('#/team/m1');
    overall.leagues = 2;
    overall.current = [
      { membershipId: 'm2', team: 'Flow', owner: '', league: 'League A', points: 5, totalScore: 0, wins: 1, losses: 0, ties: 0, place: 1, tied: false },
      { membershipId: 'b1', team: 'Team a', owner: '', league: 'League B', points: 4, totalScore: 0, wins: 1, losses: 0, ties: 0, place: 2, tied: false },
    ];
    cleanup();
    render(<HashRouter><LeaderboardsPage /></HashRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'All leagues' }));
    expect(await screen.findByText('Team a')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Team a' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Flow' }).getAttribute('href')).toBe('#/team/m2');
  });

  it('makes the whole standings row open the team', async () => {
    render(<HashRouter><LeaderboardsPage /></HashRouter>);
    expect((await screen.findByRole('link', { name: 'Flow' })).closest('li')!.classList.contains('row-target')).toBe(true);
    expect(screen.getByRole('link', { name: 'Zeal (you)' }).closest('li')!.classList.contains('row-target')).toBe(true);
    overall.leagues = 2;
    overall.current = [
      { membershipId: 'm2', team: 'Flow', owner: '', league: 'League A', points: 5, totalScore: 0, wins: 1, losses: 0, ties: 0, place: 1, tied: false },
      { membershipId: 'b1', team: 'Team a', owner: '', league: 'League B', points: 4, totalScore: 0, wins: 1, losses: 0, ties: 0, place: 2, tied: false },
    ];
    cleanup();
    render(<HashRouter><LeaderboardsPage /></HashRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'All leagues' }));
    expect((await screen.findByText('Team a')).closest('li')!.classList.contains('row-target')).toBe(false); // opens nothing
  });
});

describe('past tournaments', () => {
  /** Warmup (Oct 10): one final game, one pending; Fall beta is the one being played. */
  const played = (): TournamentRows => ({
    ...base(),
    stages: [{ id: 'S0', name: 'Warmup', starts_on: '2026-10-10', ends_on: '2026-10-11', bid_close_at: '2026-10-05T00:00:00Z', auction_seed: null,
      auction_run_at: '2026-10-06T00:00:00Z' }, base().stages[0]],
    games: [{ id: 'g1', stage_id: 'S0', number: 1, session_id: 'p1', started_at: '2026-10-10T14:00:00Z', finished_at: '2026-10-10T15:00:00Z', opponent: null },
      { id: 'g2', stage_id: 'S0', number: 2, session_id: 'p2', started_at: '2026-10-10T16:00:00Z', finished_at: null, opponent: null }],
    pairings: [{ game_id: 'g1', home: 'm1', away: 'm2' }, { game_id: 'g2', home: 'm1', away: 'm2' }],
    sessions: [{ id: 'p1', verified_at: '2026-10-10T20:00:00Z' }, { id: 'p2', verified_at: null }],
  });

  it('shows past tournaments under the standings, each opening to its results', async () => {
    rows.current = played();
    show();
    fireEvent.click(await screen.findByText(/Warmup/));
    const card = within(screen.getByRole('article', { name: 'Past tournaments' }));
    expect(card.getByRole('link', { name: 'Flow' })).toBeTruthy();
    expect(card.getByText('Waiting on stats')).toBeTruthy();
  });

  it('says no results yet for a past tournament whose only game was voided', async () => {
    const r = played();
    rows.current = { ...r, games: [{ ...r.games[0], session_id: null }], pairings: [r.pairings[0]] };
    show();
    fireEvent.click(await screen.findByText(/Warmup/));
    expect(within(screen.getByRole('article', { name: 'Past tournaments' })).getByText('No results yet.')).toBeTruthy();
  });

  it('shows no past tournaments card before any tournament is over', async () => {
    show();
    await standings();
    expect(screen.queryByText('Past tournaments')).toBeNull();
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

  it('never cuts inside a tie, and lists the whole season even when every team is 0–0 (t239)', async () => {
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
