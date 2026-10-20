// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MembershipRow } from './HomePage';
import { TeamPage } from './TeamPage';

const db = vi.hoisted(() => ({
  row: null as unknown, y: null as unknown, mine: [] as unknown[], isAdmin: false, isKeeper: false,
}));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false, isAdmin: db.isAdmin, isKeeper: db.isKeeper }),
}));
vi.mock('../lib/supabase', () => {
  const q = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: db.row, error: null }) };
  return { supabase: { from: () => q } };
});
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadLeagueTournament: () => Promise.resolve(db.y),
}));
vi.mock('./HomePage', () => ({ loadMyTeams: () => Promise.resolve(db.mine) }));

const member = (league_id: string) => ({ id: 'mine', league_id }) as MembershipRow;
const side = (membershipId: string) => ({
  membershipId, players: ['b', 'a'], share: { a: 1, b: 1 }, rest: { a: 0.45, b: 1 }, decay: { a: 1, b: 1 }, factor: { a: 0.45, b: 1 },
});
const tournament = (over: Record<string, unknown> = {}) => ({
  team: new Map([['m2', 'Flow'], ['m3', 'Idle'], ['m4', 'Old (removed)']]),
  owner: new Map([['m2', 'Sam Owner']]),
  stage: new Map([['S1', 'Fall beta']]),
  athlete: new Map([['a', 'Ari'], ['b', 'Bo']]),
  result: { games: [], next: { stageId: 'S1', number: 2, sides: [side('m2')] } },
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({ id: 'm2', league_id: 'L1', removed_at: null, leagues: { name: 'League A', season_id: 'se' }, ...over });

const visit = (id: string) => render(
  <MemoryRouter initialEntries={[`/team/${id}`]}><Routes><Route path="team/:membershipId" element={<TeamPage />} /></Routes></MemoryRouter>,
);

beforeEach(() => {
  db.row = row(); db.y = tournament(); db.mine = [member('L1')]; db.isAdmin = false; db.isKeeper = false;
});
afterEach(cleanup);

describe('TeamPage', () => {
  it('shows the team, its owner and each player with the total multiplier for its next game', async () => {
    visit('m2');
    expect(await screen.findByRole('heading', { name: 'Flow' })).toBeTruthy();
    expect(screen.getByText(/Sam Owner/)).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Ari'), expect.stringContaining('Bo')]);
    expect(screen.getByLabelText('Counts ×0.45')).toBeTruthy();
    expect(screen.queryByText(/credit|pick/i)).toBeNull();
  });

  it('names the game it is for, with the real opponent once a keeper sets it', async () => {
    db.y = tournament({ result: { games: [{ game: { stageId: 'S1', number: 2, opponent: 'Duke' } }], next: { stageId: 'S1', number: 2, sides: [side('m2')] } } });
    visit('m2');
    expect(await screen.findByText('For vs Duke · Fall beta')).toBeTruthy();
  });

  it('says no tournament on when there is no next game', async () => {
    db.y = tournament({ result: { games: [], next: null } });
    visit('m2');
    expect(await screen.findByText("No tournament on. Players show once the next tournament's shares are settled.")).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('says no players for a team without a roster, and marks a removed team', async () => {
    db.row = row({ id: 'm3' });
    visit('m3');
    expect(await screen.findByText('No players this tournament.')).toBeTruthy();
    cleanup();
    db.row = row({ id: 'm4', removed_at: '2026-10-05T00:00:00Z' });
    visit('m4');
    expect(await screen.findByRole('heading', { name: 'Old (removed)' })).toBeTruthy();
    expect(screen.getByText('No players.')).toBeTruthy();
  });

  it('refuses a team outside your leagues, and an unknown id', async () => {
    db.mine = [member('L9')];
    visit('m2');
    expect(await screen.findByText('You can only see teams in your league.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Leaderboards' }).getAttribute('href')).toBe('/leaderboards');
    expect(screen.queryByRole('heading', { name: 'Flow' })).toBeNull();
    cleanup();
    db.row = null;
    db.mine = [member('L1')];
    visit('nope');
    expect(await screen.findByText('You can only see teams in your league.')).toBeTruthy();
  });

  it('lets staff open any team', async () => {
    db.mine = [];
    db.isKeeper = true;
    visit('m2');
    expect(await screen.findByRole('heading', { name: 'Flow' })).toBeTruthy();
  });
});
