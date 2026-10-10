// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/rpc';
import { buildLeagueTournament, type OverallStanding, type TournamentRows } from '../lib/tournament';
import { AllLeagues, TournamentCard } from './TournamentCard';

const rows = vi.hoisted(() => ({ current: null as unknown as TournamentRows }));
const overall = vi.hoisted(() => ({ current: { rows: [] as OverallStanding[], leagues: 0 } }));
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadLeagueTournament: () => Promise.resolve(buildLeagueTournament(rows.current, Date.parse('2026-11-07T16:30:00Z'))),
  loadSeasonStandings: () => Promise.resolve(overall.current),
}));
vi.mock('../lib/rpc', () => ({ api: { setGamePick: vi.fn(), setBench: vi.fn(), swapBench: vi.fn() } }));

const NAMES: Record<string, string> = { a1: 'Ash', a2: 'Avery', a3: 'Alex', a4: 'Arlo', b1: 'Bea', b2: 'Quinn', b3: 'Blake', b4: 'Bryn' };
const roster = (m: string, ids: string[]) =>
  ids.map((athlete_id, i) => ({ stage_id: 'S1', membership_id: m, athlete_id, price: [30, 20, 10, 5][i], bench: false }));
/** Two teams before the tournament opens: a4 and b4 are the cheapest, so they're benched by default. */
const base = (): TournamentRows => ({
  settings: {},
  stages: [{ id: 'S1', name: 'Fall beta', starts_on: '2026-10-19', ends_on: '2026-11-08', bid_close_at: '2026-11-03T00:00:00Z', auction_seed: null,
    auction_run_at: '2026-11-04T00:00:00Z' }],
  games: [],
  pairings: [],
  members: [{ id: 'm1', team_name: 'Zeal', created_at: '2026-10-01T00:00:00Z' }, { id: 'm2', team_name: 'Flow', created_at: '2026-10-01T00:00:00Z' }],
  slots: [...roster('m1', ['a1', 'a2', 'a3', 'a4']), ...roster('m2', ['b1', 'b2', 'b3', 'b4'])],
  picks: [],
  swaps: [],
  sessions: [],
  lines: [],
  taps: [],
  injuries: [],
  athletes: Object.entries(NAMES).map(([id, name]) => ({ id, name })),
});
/** Game 1 played (finished, stats not verified): m1 started a1, m2 b1. Game 2 is paired and not started. */
const afterGame1 = (): TournamentRows => ({
  ...base(),
  games: [{ id: 'g1', stage_id: 'S1', number: 1, session_id: 'p1', started_at: '2026-11-07T14:00:00Z', finished_at: '2026-11-07T15:00:00Z',
    opponent: null }, { id: 'g2', stage_id: 'S1', number: 2, session_id: null, started_at: null, finished_at: null, opponent: null }],
  pairings: [{ game_id: 'g1', home: 'm1', away: 'm2' }, { game_id: 'g2', home: 'm1', away: 'm2' }],
  // RLS: the league sees game 1's picks (started); m2's game 2 pick, if any, is sealed and never arrives.
  picks: [{ stage_id: 'S1', game_number: 1, membership_id: 'm1', athlete_id: 'a1' },
    { stage_id: 'S1', game_number: 1, membership_id: 'm2', athlete_id: 'b1' }],
  sessions: [{ id: 'p1', verified_at: null }],
});

const confirm = vi.fn();
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.setGamePick).mockReset();
  vi.mocked(api.setBench).mockReset();
  vi.mocked(api.swapBench).mockReset();
  confirm.mockReset().mockReturnValue(true);
  window.confirm = confirm;
});
const show = async (r: TournamentRows) => {
  rows.current = r;
  render(<TournamentCard membershipId="m1" leagueId="L" seasonId="se" teamName="Zeal" subtitle="League A" />);
  await screen.findByRole('heading', { name: 'Tournament' });
};
/** The pick list in the Tournament card (game cards below repeat players' names). */
const picks = () => within(screen.getByRole('article', { name: 'Tournament' }));

describe('TournamentCard', () => {
  it('names games after the real opponent once a keeper sets it (t123)', async () => {
    const r = afterGame1();
    r.games = r.games.map((g) => (g.id === 'g1' ? { ...g, opponent: 'UNC' } : { ...g, opponent: 'Duke' }));
    await show(r);
    expect(screen.getByRole('heading', { name: 'vs Duke · Fall beta' })).toBeTruthy();
    expect(screen.getByText(/vs UNC · Fall beta/)).toBeTruthy();
  });

  it('lets a manager pre-select game 1 and choose the bench before the tournament opens', async () => {
    await show(base());
    expect(screen.getByText(/Your opponent is set when the tournament opens/)).toBeTruthy();
    expect(screen.getByText('Arlo').parentElement?.textContent).toContain('Bench');
    fireEvent.click(screen.getByRole('button', { name: 'Pick Alex' }));
    await waitFor(() => expect(api.setGamePick).toHaveBeenCalledWith('m1', 'S1', 1, 'a3'));
    fireEvent.click(screen.getByRole('button', { name: 'Bench Alex' }));
    await waitFor(() => expect(api.setBench).toHaveBeenCalledWith('m1', 'S1', ['a3']));
  });

  it("shows the next opponent, the tiredness of last game's starter, and never the opponent's sealed pick", async () => {
    await show(afterGame1());
    expect(screen.getByRole('heading', { name: 'Game 2 · Fall beta' })).toBeTruthy();
    expect(screen.getByText(/Their pick stays hidden until the game starts/).textContent).toContain('Flow');
    expect(picks().getByText('Ash').parentElement?.textContent).toContain('Tired ×0.5');
    // The header leads with the next matchup; neither side's pick is set, and theirs reads as hidden.
    expect(screen.getByRole('heading', { name: 'Zeal vs Flow' })).toBeTruthy();
    expect(screen.getByText('No pick yet')).toBeTruthy();
    expect(screen.getByText('Hidden')).toBeTruthy();
    expect(screen.getByText('Record').nextElementSibling?.textContent).toBe('0–0');
    // Quinn is who the scorer would auto-pick for Flow: shown nowhere until game 2 starts.
    expect(document.body.textContent).not.toContain('Quinn');
    expect(screen.getByText(/Waiting on stats/)).toBeTruthy(); // game 1, finished but not verified
    expect(screen.queryByRole('button', { name: /^Bench / })).toBeNull(); // the tournament has started
  });

  it('offers the bench swap for an injured active player once the tournament has started', async () => {
    await show({ ...afterGame1(), injuries: [{ athlete_id: 'a2', confirmed_at: '2026-11-07T14:30:00Z', cleared_at: null }] });
    fireEvent.click(screen.getByRole('button', { name: 'Swap in for Avery' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.swapBench).toHaveBeenCalledWith('m1', 'S1', 'a2', 'a4'));
  });

  it('keeps showing the standings between tournaments, with nothing to pick (T4)', async () => {
    // No games and no playing stage: the next auction hasn't run.
    await show({ ...base(), stages: [{ ...base().stages[0], auction_run_at: null }] });
    expect(screen.getByRole('cell', { name: 'Flow' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Games' })).toBeNull(); // nothing played: no empty section
    expect(screen.queryByRole('button', { name: /^Pick / })).toBeNull();
  });

  describe('game cards (t93, t90)', () => {
    /** Game 1 played and verified, so final: Ash (2 goals) beat Bea (1 goal). The stage is over: nothing to pick. */
    const finalGame1 = (): TournamentRows => {
      const r = afterGame1();
      return {
        ...r,
        stages: [{ ...r.stages[0], ends_on: '2026-11-06' }],
        games: r.games.filter((g) => g.id === 'g1').map((g) => ({ ...g, started_at: '2026-11-03T14:00:00Z', finished_at: '2026-11-03T15:00:00Z' })),
        pairings: r.pairings.filter((p) => p.game_id === 'g1'),
        sessions: [{ id: 'p1', verified_at: '2026-11-03T16:00:00Z' }],
        lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 2 }, points_played: 0 },
          { session_id: 'p1', athlete_id: 'b1', stats: { goal: 1 }, points_played: 0 }],
      };
    };
    const card = () => document.querySelector('.game')!;

    it('shows a final game as a small scoreboard with the caption below it', async () => {
      await show(finalGame1());
      expect(screen.getByRole('heading', { name: 'Games' })).toBeTruthy();
      expect(card().querySelector('.game-score')?.textContent).toMatch(/^Zeal[\d.]+toFlow[\d.]+$/);
      expect(card().querySelector('.game-side.lost')?.textContent).toContain('Flow');
      expect(card().querySelector('summary > .meta')?.textContent).toMatch(/^Game 1 · Fall beta\s*Final\s*W \+/);
    });

    it('says who played for whom inside an opened game', async () => {
      await show(finalGame1());
      fireEvent.click(screen.getByText(/Game 1 · Fall beta/));
      const byLines = [...card().querySelectorAll('.by')].map((el) => el.textContent);
      expect(byLines).toEqual(['Ash by Z Zeal', 'Bea by F Flow']);
    });

    it('says Bye on the card when the team sat out', async () => {
      const r = afterGame1();
      await show({ ...r, pairings: r.pairings.map((p) => (p.game_id === 'g1' ? { ...p, away: null } : p)) });
      expect(card().querySelector('.game-score')?.textContent).toBe('Bye');
    });

    it('names the Games section after the team, so several teams never share a region name (t130)', async () => {
      await show(finalGame1());
      expect(screen.getByRole('region', { name: 'Zeal games' })).toBeTruthy();
    });

    it("says Not playing on the card when the team wasn't paired in that game", async () => {
      const r = afterGame1();
      await show({ ...r, pairings: r.pairings.map((p) => (p.game_id === 'g1' ? { ...p, home: 'm2', away: null } : p)) });
      expect(card().querySelector('.game-score')?.textContent).toBe('Not playing');
    });
  });

  it('marks a game whose tally was deleted as void', async () => {
    const r = afterGame1();
    await show({ ...r, games: r.games.map((g) => (g.id === 'g1' ? { ...g, session_id: null } : g)), sessions: [] });
    fireEvent.click(screen.getByText(/Game 1 · Fall beta/));
    expect(screen.getByText('Void')).toBeTruthy();
    expect(screen.getByText(/tally was deleted/)).toBeTruthy();
    // A void start doesn't tire anyone.
    expect(picks().getByText('Ash').parentElement?.textContent).not.toContain('Tired');
  });

  describe('matchup header', () => {
    const scoreboard = () => document.querySelector('.score');

    it('shows both players once a game is live, and says scores wait for the stats', async () => {
      const r = afterGame1();
      await show({
        ...r,
        games: r.games.map((g) => (g.id === 'g2' ? { ...g, session_id: 'p2', started_at: '2026-11-07T16:00:00Z' } : g)),
        sessions: [...r.sessions, { id: 'p2', verified_at: null }],
        picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a2' },
          { stage_id: 'S1', game_number: 2, membership_id: 'm2', athlete_id: 'b2' }],
      });
      expect(screen.getByRole('heading', { name: 'Zeal vs Flow' })).toBeTruthy();
      expect(screen.getByText('Live')).toBeTruthy();
      expect(scoreboard()?.textContent).toContain('Avery');
      expect(scoreboard()?.textContent).toContain('Quinn'); // revealed: the game has started
      expect(scoreboard()?.textContent).toContain("Scores appear once this game's stats are verified.");
    });

    it('between tournaments, shows the last final game with the result and the loser greyed', async () => {
      const r = afterGame1();
      await show({
        ...r,
        stages: [{ ...r.stages[0], ends_on: '2026-11-06' }], // last day passed: nothing to pick
        // Played and verified, so the game is final.
        games: r.games.filter((g) => g.id === 'g1').map((g) => ({ ...g, started_at: '2026-11-03T14:00:00Z', finished_at: '2026-11-03T15:00:00Z' })),
        pairings: r.pairings.filter((p) => p.game_id === 'g1'),
        sessions: [{ id: 'p1', verified_at: '2026-11-03T16:00:00Z' }],
        lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 2 }, points_played: 0 },
          { session_id: 'p1', athlete_id: 'b1', stats: { goal: 1 }, points_played: 0 }],
      });
      expect(document.querySelector('.strip')?.textContent).toMatch(/Won \+/);
      expect(document.querySelector('.score-side.lost')?.textContent).toContain('Bea');
    });

    it('says Bye and shows no scoreboard when the team sits out', async () => {
      const r = afterGame1();
      await show({ ...r, pairings: r.pairings.map((p) => (p.game_id === 'g2' ? { ...p, away: null } : p)) });
      expect(document.querySelector('.strip')?.textContent).toContain('Bye');
      expect(scoreboard()).toBeNull();
    });

    it("doesn't show an injured pick as set", async () => {
      const r = afterGame1();
      await show({
        ...r,
        picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a2' }],
        injuries: [{ athlete_id: 'a2', confirmed_at: '2026-11-07T15:10:00Z', cleared_at: null }],
      });
      expect(screen.getByText('Your pick is injured')).toBeTruthy();
      expect(document.querySelector('.score-side.picked')).toBeNull();
    });
  });
});

describe('AllLeagues', () => {
  const row = (membershipId: string, team: string, league: string, place: number, tied = false): OverallStanding =>
    ({ membershipId, team, league, points: 10 - place, totalScore: 0, wins: 2, losses: 1, ties: 0, place, tied });

  it('lists every team of the season with its league, marking yours', async () => {
    overall.current = { rows: [row('b1', 'Flow', 'League B', 1), row('m1', 'Zeal', 'League A', 2, true), row('b2', 'Huck', 'League B', 2, true)], leagues: 2 };
    render(<AllLeagues seasonId="X" seasonName="Fall 2026" mine={new Set(['m1'])} />);
    const card = await screen.findByRole('article', { name: 'All leagues, Fall 2026' });
    const body = within(card).getAllByRole('row').slice(1).map((r) => r.textContent);
    expect(body).toEqual(['FlowLeague B12-1-09', 'Zeal (you)League AT22-1-08', 'HuckLeague BT22-1-08']);
  });

  it('stays hidden while the season has one league (its Standings already say it all)', async () => {
    overall.current = { rows: [row('m1', 'Zeal', 'League A', 1)], leagues: 1 };
    const { container } = render(<AllLeagues seasonId="Y" seasonName="Fall 2026" mine={new Set(['m1'])} />);
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });
});
