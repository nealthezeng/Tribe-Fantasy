// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../core/settings';
import type { MembershipRow } from './HomePage';
import { TeamPage } from './TeamPage';

const db = vi.hoisted(() => ({
  queried: [] as string[], row: null as unknown, y: null as unknown, mine: [] as unknown[], isAdmin: false, isKeeper: false,
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
  loadLeagueTournament: () => Promise.resolve(db.y),
}));
vi.mock('./HomePage', () => ({ loadMyTeams: () => Promise.resolve(db.mine) }));

const ID2 = '00000000-0000-4000-8000-000000000002', ID3 = '00000000-0000-4000-8000-000000000003';
const ID4 = '00000000-0000-4000-8000-000000000004', ID9 = '00000000-0000-4000-8000-000000000009';
const member = (league_id: string) => ({ id: 'mine', league_id }) as MembershipRow;
const side = (membershipId: string) => ({
  membershipId, players: ['b', 'a'], share: { a: 1, b: 1 }, rest: { a: 0.45, b: 1 }, decay: { a: 1, b: 1 }, factor: { a: 0.45, b: 1 },
});
const tournament = (over: Record<string, unknown> = {}) => ({
  team: new Map([[ID2, 'Flow'], [ID3, 'Idle'], [ID4, 'Old (removed)']]),
  owner: new Map([[ID2, 'Sam Owner']]),
  stage: new Map([['S1', 'Fall beta']]),
  settings: DEFAULT_SETTINGS,
  athlete: new Map([['a', 'Ari'], ['b', 'Bo']]),
  result: { games: [], next: { stageId: 'S1', number: 2, sides: [side(ID2)] } },
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({ id: ID2, league_id: 'L1', removed_at: null, leagues: { name: 'League A', season_id: 'se' }, ...over });

const visit = (id: string) => render(
  <MemoryRouter initialEntries={[`/team/${id}`]}><Routes><Route path="team/:membershipId" element={<TeamPage />} /></Routes></MemoryRouter>,
);

beforeEach(() => {
  db.queried = []; db.row = row(); db.y = tournament(); db.mine = [member('L1')]; db.isAdmin = false; db.isKeeper = false;
});
afterEach(cleanup);

describe('TeamPage', () => {
  it('shows the team, its owner and each player with the total multiplier for its next game', async () => {
    visit(ID2);
    expect(await screen.findByRole('heading', { name: 'Flow' })).toBeTruthy();
    expect(screen.getByText(/Sam Owner/)).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([expect.stringContaining('Ari'), expect.stringContaining('Bo')]);
    expect(screen.getByLabelText('Counts ×0.45')).toBeTruthy();
    expect(screen.queryByText(/credit|pick/i)).toBeNull();
  });

  it('explains the × on the team page', async () => {
    visit(ID2);
    const help = await screen.findByRole('button', { name: 'What the × means' });
    expect(help.nextElementSibling!.textContent).toContain('never below ×0.6');
  });

  it('names the next game like the pick card, with the real opponent once a keeper sets it', async () => {
    db.y = tournament({ result: { games: [{ game: { stageId: 'S1', number: 2, opponent: 'Duke' } }], next: { stageId: 'S1', number: 2, sides: [side(ID2)] } } });
    visit(ID2);
    expect(await screen.findByText('vs Duke · Fall beta')).toBeTruthy();
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
