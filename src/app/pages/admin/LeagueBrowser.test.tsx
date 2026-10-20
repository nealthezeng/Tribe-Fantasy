// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLeagueTournament, type TournamentRows } from '../../lib/tournament';
import { LeagueBrowser, loadLeagueAdminData } from './LeagueBrowser';

const NOW = Date.parse('2026-11-07T16:30:00Z');
const ROWS = vi.hoisted(() => ({ current: {} as Record<string, unknown[]>, league: null as unknown as TournamentRows }));
vi.mock('../../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../../lib/tournament')>()),
  loadLeagueTournament: () => Promise.resolve(buildLeagueTournament(ROWS.league, NOW)),
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder, in: () => builder, range: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: ROWS.current[table] ?? [], error: null }),
      };
      return builder;
    },
  },
}));

const at = (m: string, ids: string[], share: number) =>
  ids.map((athlete_id) => ({ stage_id: 'S1', membership_id: m, athlete_id, price: 10, share, from_game: 1, until_game: null }));
const stage = (id: string, extra: object) => ({ id, name: id, starts_on: '2026-11-01', ends_on: '2026-11-08', bid_close_at: '2026-11-03T00:00:00Z',
  auction_seed: null, auction_run_at: '2026-11-04T00:00:00Z', ...extra });
const member = (id: string, team_name: string, removed_at: string | null = null) =>
  ({ id, team_name, created_at: '2026-10-01T00:00:00Z', removed_at });

/** Gimp Zeal (Alice) and Money (removed account); S1 is playing, S2's share buying is open and holds one sealed buy. */
function setup() {
  ROWS.league = {
    settings: {},
    stages: [stage('S1', {}), stage('S2', { starts_on: '2026-11-15', ends_on: '2026-11-22', bid_close_at: '2099-01-01T00:00:00Z', auction_run_at: null })],
    games: [{ id: 'g1', stage_id: 'S1', number: 1, session_id: 'p1', started_at: '2026-11-07T14:00:00Z', finished_at: '2026-11-07T15:00:00Z', opponent: null },
      { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null, opponent: null }],
    pairings: [{ game_id: 'g1', home: 'm1', away: 'm2' }, { game_id: 'g2', home: 'm1', away: 'm2' }],
    members: [member('m1', 'Gimp Zeal'), member('m2', 'Money', '2026-11-05T00:00:00Z')],
    slots: [...at('m1', ['a1', 'a2'], 0.25), ...at('m2', ['b1'], 0.5)],
    // Sealed until game 2 starts; only an admin's read returns them.
    picks: [{ stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a2' }],
    sessions: [{ id: 'p1', verified_at: null }], lines: [], taps: [], injuries: [],
    athletes: [{ id: 'a1', name: 'Ash' }, { id: 'a2', name: 'Avery' }, { id: 'b1', name: 'Bea' }],
  };
  ROWS.current = {
    leagues: [{ name: 'Huck Yeah' }],
    memberships: [{ id: 'm1', user_id: 'u1' }, { id: 'm2', user_id: null }],
    profiles: [{ id: 'u1', display_name: 'Alice Kim' }],
    credit_ledger: [{ membership_id: 'm1', amount: 100 }, { membership_id: 'm1', amount: -15 }, { membership_id: 'm2', amount: 40 }],
    stages: ROWS.league.stages,
    bids: [{ membership_id: 'm2', athlete_id: 'b1', amount: 12 }],
    athletes: ROWS.league.athletes,
  };
}
afterEach(cleanup);

describe('LeagueBrowser', () => {
  it('loads owners, balances, the open buys and the players for the editor', async () => {
    setup();
    const d = await loadLeagueAdminData('se', 'L');
    expect([...d.owners]).toEqual([['m1', 'Alice Kim'], ['m2', 'Removed user']]);
    expect([...d.balances]).toEqual([['m1', 85], ['m2', 40]]);
    expect(d.sealedBuys).toEqual([{ membershipId: 'm2', athleteId: 'b1', amount: 12 }]);
    expect(d.players).toEqual(ROWS.league.athletes);
    expect([d.stageId, d.nextGame]).toEqual(['S1', 2]);
  });

  it("shows each team's owner, balance, record, roster shares, picks and buys, and the games' pairings", async () => {
    setup();
    const close = vi.fn();
    render(<LeagueBrowser seasonId="se" leagueId="L" onClose={close} />);
    expect(await screen.findByRole('heading', { name: 'Huck Yeah' })).toBeTruthy();

    const zeal = within(screen.getByRole('article', { name: 'Gimp Zeal' }));
    expect(zeal.getByText('Alice Kim')).toBeTruthy();
    expect(zeal.getByText('85 credits')).toBeTruthy();
    expect(zeal.getByText('Ash · 25%')).toBeTruthy();
    expect(zeal.getByText('Avery · 25%')).toBeTruthy();
    expect(zeal.getByText('Picks for Game 2: Avery')).toBeTruthy();

    const money = within(screen.getByRole('article', { name: 'Money (removed)' }));
    expect(money.getByText('Removed user')).toBeTruthy();
    expect(money.getByText('Bea · 50%')).toBeTruthy();
    expect(money.getByText('40 credits')).toBeTruthy();
    expect(money.getByText('No picks for Game 2')).toBeTruthy();

    const buys = within(screen.getByRole('region', { name: 'Buys so far' }));
    expect(buys.getByText('Money (removed)')).toBeTruthy();
    expect(buys.getByText('Bea')).toBeTruthy();
    expect(buys.getByText('12 credits')).toBeTruthy();

    expect(screen.getByText('Game 1 · Gimp Zeal vs Money (removed)')).toBeTruthy();
    expect(screen.getByText('Game 2 · Gimp Zeal vs Money (removed)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(close).toHaveBeenCalled();
  });

  it('has no Buys section once share buying has closed', async () => {
    setup();
    ROWS.current.stages = [stage('S1', {})];
    render(<LeagueBrowser seasonId="se" leagueId="L" onClose={() => {}} />);
    await screen.findByRole('article', { name: 'Gimp Zeal' });
    expect(screen.queryByText('Buys so far')).toBeNull();
  });
});
