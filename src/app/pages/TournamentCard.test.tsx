// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/rpc';
import { buildLeagueTournament, type TournamentRows } from '../lib/tournament';
import { TournamentCard } from './TournamentCard';

const rows = vi.hoisted(() => ({ current: null as unknown as TournamentRows }));
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadLeagueTournament: () => Promise.resolve(buildLeagueTournament(rows.current, Date.parse('2026-11-07T16:30:00Z'))),
}));
vi.mock('../lib/rpc', () => ({ api: { setGamePick: vi.fn() } }));

const NAMES: Record<string, string> = { a1: 'Ash', a2: 'Avery', a3: 'Alex', a4: 'Arlo', b1: 'Bea', b2: 'Quinn', b3: 'Blake', b4: 'Bryn' };
const roster = (m: string, ids: string[], shares = [1, 1, 1, 1]) =>
  ids.map((athlete_id, i) => ({ stage_id: 'S1', membership_id: m, athlete_id, price: [30, 20, 10, 5][i], share: shares[i], from_game: 1, until_game: null }));
/** Two teams of four players before the tournament opens. */
const base = (): TournamentRows => ({
  settings: {},
  stages: [{ id: 'S1', name: 'Fall beta', starts_on: '2026-10-19', ends_on: '2026-11-08', bid_close_at: '2026-11-03T00:00:00Z', auction_seed: null,
    auction_run_at: '2026-11-04T00:00:00Z' }],
  games: [],
  pairings: [],
  members: [{ id: 'm1', team_name: 'Zeal', created_at: '2026-10-01T00:00:00Z', removed_at: null }, { id: 'm2', team_name: 'Flow', created_at: '2026-10-01T00:00:00Z', removed_at: null }],
  slots: [...roster('m1', ['a1', 'a2', 'a3', 'a4']), ...roster('m2', ['b1', 'b2', 'b3', 'b4'])],
  picks: [],
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

afterEach(cleanup);
beforeEach(() => {
  // Saves the way set_game_pick does: the set replaces this team's picks for that game.
  vi.mocked(api.setGamePick).mockReset().mockImplementation((m, stage, n, ids) => {
    rows.current = { ...rows.current, picks: [...rows.current.picks.filter((p) => !(p.membership_id === m && p.game_number === n)),
      ...ids.map((athlete_id) => ({ stage_id: stage, game_number: n, membership_id: m, athlete_id }))] };
    return Promise.resolve();
  });
});
const show = async (r: TournamentRows) => {
  rows.current = r;
  render(<MemoryRouter><TournamentCard membershipId="m1" leagueId="L" seasonId="se" teamName="Zeal" subtitle="League A" /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull()); // loaded
};
/** The pick list in the Next game card (game cards below repeat players' names). */
const picks = () => within(screen.getByRole('article', { name: 'Next game' }));

describe('TournamentCard', () => {
  it('names games after the real opponent once a keeper sets it (t123)', async () => {
    const r = afterGame1();
    r.games = r.games.map((g) => (g.id === 'g1' ? { ...g, opponent: 'UNC' } : { ...g, opponent: 'Duke' }));
    await show(r);
    expect(screen.getByRole('heading', { name: 'vs Duke · Fall beta' })).toBeTruthy();
    expect(screen.getByText(/vs UNC · Fall beta/)).toBeTruthy();
  });

  it('links both teams in the matchup headline and the opponent on the pick card', async () => {
    await show(afterGame1());
    const hrefs = (name: string) => screen.getAllByRole('link', { name }).map((a) => a.getAttribute('href'));
    expect(hrefs('Zeal')).toEqual(['/team/m1']);
    expect(hrefs('Flow')).toEqual(['/team/m2', '/team/m2']); // headline, "You play"
    expect(picks().getByRole('link', { name: 'Flow' }).getAttribute('href')).toBe('/team/m2');
  });

  it('pre-selects two players for game 1, then refuses a third until one is cleared', async () => {
    await show(base());
    expect(screen.getByText('Opponent TBD.')).toBeTruthy();
    expect(picks().getByText(/^Pick 2/).parentElement?.textContent).toBe('Pick 20 of 2');
    fireEvent.click(picks().getByRole('button', { name: 'Pick Alex' }));
    await waitFor(() => expect(api.setGamePick).toHaveBeenLastCalledWith('m1', 'S1', 1, ['a3']));
    await waitFor(() => expect(picks().getByText('1 of 2')).toBeTruthy()); // reloaded with Alex picked
    fireEvent.click(picks().getByRole('button', { name: 'Pick Ash' }));
    await waitFor(() => expect(api.setGamePick).toHaveBeenLastCalledWith('m1', 'S1', 1, ['a3', 'a1']));
    await waitFor(() => expect(picks().getAllByRole('button', { pressed: true })).toHaveLength(2));
    expect(picks().getByText('2 of 2')).toBeTruthy();
    expect((picks().getByRole('button', { name: 'Pick Avery' }) as HTMLButtonElement).disabled).toBe(true);
    expect(picks().getByText('You have 2 picks. Clear one to change.')).toBeTruthy();
    // Clearing Alex (rows list by name) sends Ash alone.
    fireEvent.click(picks().getAllByRole('button', { pressed: true })[0]);
    await waitFor(() => expect(api.setGamePick).toHaveBeenLastCalledWith('m1', 'S1', 1, ['a1']));
    expect(screen.queryByRole('button', { name: /^Bench / })).toBeNull(); // no bench any more (C3)
  });

  it("shows each player's combined factor, with share, tiredness and earlier tournaments one tap away (decision 11)", async () => {
    const r = afterGame1();
    // An earlier tournament where Zeal started Ash: with no grace, Ash carries x0.9 into this one.
    const S0 = { ...r.stages[0], id: 'S0', name: 'Opener', starts_on: '2026-10-03', ends_on: '2026-10-04' };
    await show({
      ...r,
      settings: { decay_grace_stages: 0 },
      stages: [S0, ...r.stages],
      games: [{ id: 'g0', stage_id: 'S0', number: 1, session_id: 'p0', started_at: '2026-10-03T14:00:00Z', finished_at: '2026-10-03T15:00:00Z',
        opponent: null }, ...r.games],
      pairings: [{ game_id: 'g0', home: 'm1', away: 'm2' }, ...r.pairings],
      slots: [{ stage_id: 'S0', membership_id: 'm1', athlete_id: 'a1', price: 10, share: 1, from_game: 1, until_game: null },
        ...roster('m1', ['a1', 'a2', 'a3', 'a4'], [0.5, 1, 0.4, 1]), ...roster('m2', ['b1', 'b2', 'b3', 'b4'])],
      picks: [{ stage_id: 'S0', game_number: 1, membership_id: 'm1', athlete_id: 'a1' }, ...r.picks],
      sessions: [{ id: 'p0', verified_at: '2026-10-03T16:00:00Z' }, ...r.sessions],
    });
    const row = (name: string) => picks().getByText(name).closest('li')!;
    // Ash: half of him, started last game (x0.5), started in the opener (x0.9).
    expect(row('Ash').querySelector('summary')?.textContent).toBe('×0.23');
    expect(row('Ash').querySelector('.parts')?.textContent).toBe('50% share×0.5 tired×0.9 earlier tournaments');
    expect(row('Arlo').querySelector('summary')?.textContent).toBe('×1');
    expect(row('Arlo').querySelector('.parts')?.textContent).toBe('100% share×1 rested'); // x1 earlier tournaments is left out
    expect(row('Alex').querySelector('summary')?.textContent).toBe('×0.4');
  });

  it("shows a combined factor of x0.25 for a half share of last game's starter", async () => {
    const r = afterGame1();
    await show({ ...r, slots: [...roster('m1', ['a1', 'a2', 'a3', 'a4'], [0.5, 1, 1, 1]), ...roster('m2', ['b1', 'b2', 'b3', 'b4'])] });
    expect(picks().getByText('Ash').closest('li')?.textContent).toContain('×0.25');
  });

  it('names who plays for an injured pick, and says when an injured pick still plays', async () => {
    const r = afterGame1();
    await show({
      ...r,
      picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a2' },
        { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a3' }],
      injuries: [{ athlete_id: 'a2', confirmed_at: '2026-11-07T15:10:00Z', cleared_at: null }],
    });
    // Arlo is the most rested healthy player left (Ash started game 1).
    expect(picks().getByText('Avery is injured. Arlo plays.')).toBeTruthy();
    cleanup();
    // A one-player team: nobody healthy is free, so the injured pick plays anyway. Not a swap.
    await show({
      ...r,
      slots: [...roster('m1', ['a1']), ...roster('m2', ['b1', 'b2'])],
      picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a1' }],
      injuries: [{ athlete_id: 'a1', confirmed_at: '2026-11-07T15:10:00Z', cleared_at: null }],
    });
    expect(picks().getByText('Ash is injured and still plays: nobody else is free.')).toBeTruthy();
    expect(picks().queryByText(/Ash plays/)).toBeNull();
  });

  it('does not call a swap "still plays" when a spare came in for one injured pick and an injured pick filled the other', async () => {
    const r = afterGame1();
    // Ash and Avery are both picked and injured; Alex is the only healthy spare. The core pairs Ash->Alex and Avery->Ash.
    await show({
      ...r,
      slots: [...roster('m1', ['a1', 'a2', 'a3']), ...roster('m2', ['b1', 'b2', 'b3', 'b4'])],
      picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a1' },
        { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a2' }],
      injuries: [{ athlete_id: 'a1', confirmed_at: '2026-11-07T15:10:00Z', cleared_at: null },
        { athlete_id: 'a2', confirmed_at: '2026-11-07T15:10:00Z', cleared_at: null }],
    });
    expect(picks().queryByText(/still plays/)).toBeNull();
    expect(picks().getByText('Ash is injured. Alex plays.')).toBeTruthy();
  });

  it('says who plays if you leave a pick empty', async () => {
    const r = afterGame1();
    await show({ ...r, picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a3' }] });
    expect(picks().getByText(/^If you don't pick, (Avery|Arlo) plays\.$/)).toBeTruthy();
    expect(picks().getByText('1 of 2')).toBeTruthy();
    // The scoreboard holds your picks, green only once both are in.
    expect(document.querySelector('.score-side')?.textContent).toBe('Your picksAlex');
    expect(document.querySelector('.score-side.picked')).toBeNull();
    cleanup();
    await show({ ...r, picks: [...r.picks, ...['a3', 'a4'].map((athlete_id) => ({ stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id }))] });
    expect(document.querySelector('.score-side.picked')?.textContent).toBe('Your picksAlexArlo');
    expect(picks().queryByText(/If you don't pick/)).toBeNull();
  });

  const owners = () => [...document.querySelectorAll('.display .side')].map((el) => [el.firstChild?.textContent, el.querySelector('.owner')?.textContent ?? null]);

  it('puts each owner under its own team name in the headline', async () => {
    await show({ ...afterGame1(), members: [{ ...base().members[0], user_id: 'u1' }, { ...base().members[1], user_id: 'u2' }],
      profiles: [{ id: 'u1', display_name: 'Neal Zeng' }, { id: 'u2', display_name: 'Sam Sample' }] });
    expect(await screen.findByRole('heading', { name: 'Zeal Neal Zeng vs Flow Sam Sample' })).toBeTruthy();
    expect(owners()).toEqual([['Zeal', 'Neal Zeng'], ['Flow', 'Sam Sample']]);
  });

  it('reads "Removed user" for a removed opponent and renders nothing for an owner without a profile', async () => {
    await show({ ...afterGame1(), members: [{ ...base().members[0], user_id: 'u1' }, { ...base().members[1], user_id: null, removed_at: '2026-11-08T00:00:00Z' }],
      profiles: [] });
    expect(await screen.findByText('Removed user')).toBeTruthy();
    expect(owners()).toEqual([['Zeal', null], ['Flow (removed)', 'Removed user']]);
    expect(document.body.textContent).not.toContain('undefined');
  });

  it("shows the next opponent, the tiredness of last game's starter, and never the opponent's sealed pick", async () => {
    await show(afterGame1());
    expect(screen.getByRole('heading', { name: 'Game 2 · Fall beta' })).toBeTruthy();
    expect(screen.getByText(/^You play/).textContent).toBe('You play Flow.');
    expect(picks().getByText('Ash').closest('li')?.textContent).toContain('×0.5 tired');
    // The header leads with the next matchup; neither side's picks are set, and theirs read as hidden.
    expect(screen.getByRole('heading', { name: 'Zeal vs Flow' })).toBeTruthy();
    expect(screen.getByText('No picks yet')).toBeTruthy();
    expect(screen.getByText('Hidden')).toBeTruthy();
    expect(screen.queryByText('Record')).toBeNull(); // game 1 isn't verified: no game counts yet, so no tiles (t228)
    // Blake and Bryn (rested) are who the scorer would auto-pick for Flow: shown nowhere until game 2 starts.
    expect(document.body.textContent).not.toContain('Blake');
    expect(document.body.textContent).not.toContain('Bryn');
    expect(screen.getByText(/Waiting on stats/)).toBeTruthy(); // game 1, finished but not verified
  });

  it('has no standings on the League tab any more (they moved to Leaderboards), and nothing to pick between tournaments (T4)', async () => {
    // No games and no playing stage: the next auction hasn't run.
    await show({ ...base(), stages: [{ ...base().stages[0], auction_run_at: null }] });
    expect(screen.queryByRole('article', { name: 'Standings' })).toBeNull();
    expect(document.querySelector('.strip')?.textContent).toContain('No games yet');
    expect(screen.queryByRole('heading', { name: 'Games' })).toBeNull(); // nothing played: no empty section
    expect(screen.queryByRole('button', { name: /^Pick / })).toBeNull();
  });

  describe('game cards (t93, t90)', () => {
    /** Game 1 played and verified, so final: Ash (2 goals) beat Bea (1 goal); each 2nd starter was auto-picked. The stage is over. */
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

    it('lists each starter inside an opened game as game score × factor = points', async () => {
      const r = finalGame1();
      await show({
        ...r,
        slots: [...roster('m1', ['a1', 'a2', 'a3', 'a4'], [0.5, 1, 1, 1]), ...roster('m2', ['b1', 'b2', 'b3', 'b4'])],
        lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 3, turnover: 2 }, points_played: 0 }, ...r.lines.slice(1)],
      });
      fireEvent.click(screen.getByText(/Game 1 · Fall beta/));
      expect([...card().querySelectorAll('.by')].map((el) => el.textContent)).toEqual(['Zeal', 'Flow']);
      // 3 goals x 3 - 2 turnovers x 1 = 7, and Zeal owns half of Ash.
      const ash = [...card().querySelectorAll('li')].find((li) => li.textContent?.startsWith('Ash'))!;
      expect(ash.querySelector('small')?.textContent).toBe('Ash · 3 Goal, 2 Turnover');
      expect(ash.querySelector('.calc')?.textContent).toBe('7 × 0.5 = 3.5');
      expect(card().textContent).toContain("You didn't pick, so");
      expect(card().textContent).toContain("Flow didn't pick, so"); // not "You": the viewer is Zeal
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
    expect(screen.getByText("Doesn't count.")).toBeTruthy();
    // A void start doesn't tire anyone.
    expect(picks().getByText('Ash').closest('li')?.textContent).not.toContain('tired');
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
      expect(scoreboard()?.textContent).toContain('They played');
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
      expect(document.querySelector('.score-side')?.textContent).toMatch(/^You played[\d.]+Ash\w+$/); // two starters
      expect(screen.getByText('Record').nextElementSibling?.textContent).toBe('1–0');
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
