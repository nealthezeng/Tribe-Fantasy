// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../core/settings';
import type { MembershipRow } from './HomePage';
import { TeamPage } from './TeamPage';

const db = vi.hoisted(() => ({
  queried: [] as string[], row: null as unknown, y: null as unknown, mine: [] as unknown[], isAdmin: false, isKeeper: false,
  loadArgs: [] as unknown[],
}));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false, isAdmin: db.isAdmin, isKeeper: db.isKeeper }),
}));
vi.mock('../lib/supabase', () => {
  const q = { select: () => q, eq: (_c: string, v: string) => { db.queried.push(v); return q; }, maybeSingle: () => Promise.resolve({ data: db.row, error: null }) };
  return { supabase: { from: () => q } };
});
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadLeagueTournament: (...args: unknown[]) => { db.loadArgs = args; return Promise.resolve(db.y); },
}));
vi.mock('./HomePage', () => ({ loadMyTeams: () => Promise.resolve(db.mine) }));

const ID2 = '00000000-0000-4000-8000-000000000002', ID3 = '00000000-0000-4000-8000-000000000003';
const ID4 = '00000000-0000-4000-8000-000000000004', ID9 = '00000000-0000-4000-8000-000000000009';
const member = (league_id: string) => ({ id: 'mine', league_id }) as MembershipRow;
/** Finn: 15%, started the game before (half points); Rory: 10%, rested, cut to 90% by earlier tournaments. */
const side = (membershipId: string, over: Record<string, unknown> = {}) => ({
  membershipId, players: ['b', 'a'], share: { a: 0.15, b: 0.1 }, rest: { a: 0.5, b: 1 }, decay: { a: 1, b: 0.9 }, factor: { a: 0.075, b: 0.09 },
  score: null, ...over,
});
/** Game `number` of Fall beta, Flow against Gimp Zeal. */
const game = (number: number, status: string, over: Record<string, unknown> = {}) => ({
  game: { id: `g${number}`, stageId: 'S1', number, opponent: null }, status, heldBy: null,
  matchups: [{ home: side(ID2), away: side(ID3) }], ...over,
});
const tournament = (over: Record<string, unknown> = {}) => ({
  team: new Map([[ID2, 'Flow'], [ID3, 'Gimp Zeal'], [ID4, 'Old (removed)']]),
  owner: new Map([[ID2, 'Sam Owner']]),
  stage: new Map([['S1', 'Fall beta']]),
  settings: DEFAULT_SETTINGS,
  athlete: new Map([['a', 'Finn Garza'], ['b', 'Rory Vance']]),
  unofficial: new Map(),
  result: { games: [], next: { stageId: 'S1', number: 2, sides: [side(ID2)] } },
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({ id: ID2, league_id: 'L1', removed_at: null, leagues: { name: 'League A', season_id: 'se' }, ...over });

const visit = (id: string) => render(
  <MemoryRouter initialEntries={[`/team/${id}`]}><Routes><Route path="team/:membershipId" element={<TeamPage />} /></Routes></MemoryRouter>,
);

beforeEach(() => {
  db.queried = []; db.row = row(); db.y = tournament(); db.mine = [member('L1')]; db.isAdmin = false; db.isKeeper = false; db.loadArgs = [];
});
afterEach(cleanup);

describe('TeamPage', () => {
  it('shows the team and its owner, never credits or picks', async () => {
    visit(ID2);
    expect(await screen.findByRole('heading', { name: 'Flow' })).toBeTruthy();
    expect(screen.getByText(/Sam Owner/)).toBeTruthy();
    expect(screen.queryByText(/credit|pick/i)).toBeNull();
  });

  it('lists players as rows with share and tiredness in words, no × chip', async () => {
    visit(ID2);
    const players = within((await screen.findByText('Finn Garza')).closest('ul')!);
    expect(players.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Finn Garza15% · played game 1: half points', 'Rory Vance10% · rested · earlier tournaments: 90%']);
    expect(players.getByText('Finn Garza').className).toBe('title');
    expect(document.querySelector('details.factor')).toBeNull();
    expect(players.queryByText(/×/)).toBeNull();
  });

  it("shows the team's live game as a row", async () => {
    const live = game(2, 'live');
    db.y = tournament({
      unofficial: new Map([['g2', { ...live, matchups: [{ home: side(ID2, { score: 0.45 }), away: side(ID3, { score: 1.35 }) }] }]]),
      result: { games: [game(1, 'final'), live, game(3, 'upcoming')], next: { stageId: 'S1', number: 3, sides: [side(ID2)] } },
    });
    visit(ID2);
    const focus = (await screen.findByText('Game 2 vs Gimp Zeal')).closest('.row-link')!;
    expect(within(focus as HTMLElement).getByText('0.45 vs 1.35 · unofficial')).toBeTruthy();
    expect(focus.querySelector('.live')?.textContent).toBe('Live');
    expect(screen.queryByText(/^Game [13]/)).toBeNull(); // one row: the live game, not the next
    expect(db.loadArgs[2]).toEqual({ live: true }); // live numbers need the live taps
  });

  it('shows the next game as the row when nothing is live, with the real opponent once a keeper sets it', async () => {
    db.y = tournament({ result: { games: [game(2, 'upcoming', { game: { id: 'g2', stageId: 'S1', number: 2, opponent: 'Duke' } })],
      next: { stageId: 'S1', number: 2, sides: [side(ID2)] } } });
    visit(ID2);
    const row = (await screen.findByText('Game 2 vs Gimp Zeal')).closest('.row-link') as HTMLElement;
    expect(within(row).getByText('vs Duke')).toBeTruthy();
    expect(within(row).getByText('Not started')).toBeTruthy();
    expect(row.querySelector('button.help')).toBeTruthy(); // FactorHelp beside the next-game row
  });

  it('says Bye on the row when the team has no opponent', async () => {
    db.y = tournament({ result: { games: [game(2, 'upcoming', { matchups: [{ home: side(ID2), away: null }] })],
      next: { stageId: 'S1', number: 2, sides: [side(ID2)] } } });
    visit(ID2);
    const focus = within((await screen.findByText('Game 2')).closest('.row-link') as HTMLElement);
    expect(focus.getByText('Bye')).toBeTruthy();
  });

  it('goes back where you came from', async () => {
    render(
      <MemoryRouter initialEntries={['/stats', `/team/${ID2}`]}>
        <Routes><Route path="team/:membershipId" element={<TeamPage />} /><Route path="stats" element={<p>stats page</p>} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '← Back' }));
    expect(await screen.findByText('stats page')).toBeTruthy();
    cleanup();
    visit(ID2); // opened directly: nothing to go back to in the app
    expect((await screen.findByRole('link', { name: '← Leaderboards' })).getAttribute('href')).toBe('/leaderboards');
    expect(screen.queryByRole('button', { name: '← Back' })).toBeNull();
  });

  it('explains how points count on the team page', async () => {
    visit(ID2);
    const help = await screen.findByRole('button', { name: "How a player's points count" });
    expect(help.nextElementSibling!.textContent).toContain('never below 60%');
  });

  it('says no tournament on when there is no next game', async () => {
    db.y = tournament({ result: { games: [], next: null } });
    visit(ID2);
    expect(await screen.findByText("No tournament on. Players show once the next tournament's shares are settled.")).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('says no players for a team without a roster, and marks a removed team', async () => {
    db.row = row({ id: ID3 });
    visit(ID3);
    expect(await screen.findByText('No players this tournament.')).toBeTruthy();
    cleanup();
    db.row = row({ id: ID4, removed_at: '2026-10-05T00:00:00Z' });
    visit(ID4);
    expect(await screen.findByRole('heading', { name: 'Old (removed)' })).toBeTruthy();
    expect(screen.getByText('No players.')).toBeTruthy();
  });

  it('refuses a team outside your leagues, and an unknown id', async () => {
    db.mine = [member('L9')];
    visit(ID2);
    expect(await screen.findByText('You can only see teams in your league.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Leaderboards' }).getAttribute('href')).toBe('/leaderboards');
    expect(screen.queryByRole('heading', { name: 'Flow' })).toBeNull();
    cleanup();
    db.row = null;
    db.mine = [member('L1')];
    visit(ID9);
    expect(await screen.findByText('You can only see teams in your league.')).toBeTruthy();
  });

  it('refuses a malformed id without asking the database', async () => {
    visit('not-a-uuid');
    expect(await screen.findByText('You can only see teams in your league.')).toBeTruthy();
    expect(db.queried).toEqual([]);
  });

  it('lets staff open any team', async () => {
    db.mine = [];
    db.isKeeper = true;
    visit(ID2);
    expect(await screen.findByRole('heading', { name: 'Flow' })).toBeTruthy();
  });
});
