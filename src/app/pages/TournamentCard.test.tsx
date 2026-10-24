// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/rpc';
import { seenKey } from '../lib/seen';
import { buildLeagueTournament, loadLeagueTournament, type TournamentRows } from '../lib/tournament';
import { TournamentCard } from './TournamentCard';

const rows = vi.hoisted(() => ({ current: null as unknown as TournamentRows }));
vi.mock('../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../lib/tournament')>()),
  loadLeagueTournament: vi.fn<(s: string, l: string, o?: unknown) => Promise<unknown>>(() => Promise.resolve(buildLeagueTournament(rows.current, Date.parse('2026-11-07T16:30:00Z')))),
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
  injuries: [], outs: [],
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

/**
 * Game 1 played and verified, so final: Ash (2 goals) beat Bea (1 goal); each 2nd starter was auto-picked. Its only
 * game is finished, so the tournament is over (no pick card), though its last day hasn't passed.
 */
const finalGame1 = (): TournamentRows => {
  const r = afterGame1();
  return {
    ...r,
    games: r.games.filter((g) => g.id === 'g1').map((g) => ({ ...g, started_at: '2026-11-03T14:00:00Z', finished_at: '2026-11-03T15:00:00Z' })),
    pairings: r.pairings.filter((p) => p.game_id === 'g1'),
    sessions: [{ id: 'p1', verified_at: '2026-11-03T16:00:00Z' }],
    lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 2 }, points_played: 0 },
      { session_id: 'p1', athlete_id: 'b1', stats: { goal: 1 }, points_played: 0 }],
  };
};

/** Game 1 live (started 14:00, not finished): Ash scored twice (6), Bea blocked once (5). */
const tap = (id: string, athlete_id: string, stat: string, at: string) =>
  ({ id, session_id: 'p1', athlete_id, stat, keeper_id: 'k1', tapped_at: `2026-11-07T${at}:00Z`, undoes: null });
const TAPS = [tap('t1', 'a1', 'goal', '14:01'), tap('t2', 'a1', 'goal', '14:03'), tap('t3', 'b1', 'block', '14:05')];
const liveGame1 = (): TournamentRows => {
  const r = afterGame1();
  return { ...r, games: r.games.map((g) => (g.id === 'g1' ? { ...g, finished_at: null } : g)), taps: TAPS };
};

/** liveGame1 plus an earlier tournament, Feasterns (ended Oct 10), whose game 4 vs Wake Forest was left live (fake-user round 2). */
const staleAndCurrent = (): TournamentRows => {
  const r = liveGame1();
  return {
    ...r,
    stages: [{ ...r.stages[0], id: 'S0', name: 'Feasterns', starts_on: '2026-10-09', ends_on: '2026-10-10', bid_close_at: '2026-10-07T00:00:00Z',
      auction_run_at: '2026-10-08T00:00:00Z' }, ...r.stages],
    games: [{ id: 'g0', stage_id: 'S0', number: 4, session_id: 'p0', started_at: '2026-10-10T15:00:00Z', finished_at: null, opponent: 'Wake Forest' },
      ...r.games],
    pairings: [{ game_id: 'g0', home: 'm1', away: 'm2' }, ...r.pairings],
    sessions: [{ id: 'p0', verified_at: null }, ...r.sessions],
  };
};
/** Between tournaments: Fall beta is buying (not settled), with no games or pairings yet; only Feasterns' game 4 is live. */
const staleBetween = (): TournamentRows => {
  const r = staleAndCurrent();
  return {
    ...r,
    stages: [r.stages[0], { ...r.stages[1], bid_close_at: '2026-11-10T00:00:00Z', auction_run_at: null }],
    games: r.games.filter((g) => g.stage_id === 'S0'),
    pairings: r.pairings.filter((p) => p.game_id === 'g0'),
    sessions: r.sessions.filter((s) => s.id === 'p0'),
    picks: [],
    taps: [],
  };
};

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadLeagueTournament).mockClear();
  // Saves the way set_game_pick does: the set replaces this team's picks for that game.
  vi.mocked(api.setGamePick).mockReset().mockImplementation((m, stage, n, ids) => {
    rows.current = { ...rows.current, picks: [...rows.current.picks.filter((p) => !(p.membership_id === m && p.game_number === n)),
      ...ids.map((athlete_id) => ({ stage_id: stage, game_number: n, membership_id: m, athlete_id }))] };
    return Promise.resolve();
  });
});
const show = async (r: TournamentRows) => {
  rows.current = r;
  render(<MemoryRouter><TournamentCard membershipId="m1" leagueId="L" seasonId="se" teamName="Zeal" subtitle="League A" leagueName="League A" /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull()); // loaded
};
/** The pick list in the Next game card (game cards below repeat players' names). */
const picks = () => within(screen.getByRole('article', { name: 'Next game' }));

describe('TournamentCard', () => {
  it('names games after the real opponent once a keeper sets it (t123)', async () => {
    const r = afterGame1();
    r.games = r.games.map((g) => (g.id === 'g1' ? { ...g, opponent: 'UNC' } : { ...g, opponent: 'Duke' }));
    await show(r);
    expect(screen.getByRole('heading', { name: 'Pick 2 for game 2 vs Duke' })).toBeTruthy();
    // The game lines: the number big, the opponent in small text.
    expect([...document.querySelectorAll('.game-line .teams > small')].map((e) => e.textContent)).toEqual(['vs UNC', 'vs Duke']);
  });

  it('links both teams in the matchup headline and the opponent on the pick card', async () => {
    await show(afterGame1());
    const hrefs = (name: string) => screen.getAllByRole('link', { name }).map((a) => a.getAttribute('href'));
    expect(hrefs('Zeal')).toEqual(['/team/m1']);
    expect(hrefs('Flow')).toEqual(['/team/m2', '/team/m2']); // headline, "You play"
    expect(picks().getByRole('link', { name: 'Flow' }).getAttribute('href')).toBe('/team/m2');
  });

  /** A player's row in the pick card: the whole row is the toggle button. */
  const pickRow = (name: string) => picks().getByRole('button', { name: new RegExp(`^${name}\\b`) }) as HTMLButtonElement;
  /** "true" from a tap until the reload after its save lands: taps meanwhile are held. */
  const rowsBusy = () => screen.getByRole('article', { name: 'Next game' }).querySelector('[aria-busy]')?.getAttribute('aria-busy');

  it('pre-selects two players for game 1, then refuses a third until one is cleared', async () => {
    await show(base());
    expect(picks().getByText('Picks lock when a keeper starts game 1.')).toBeTruthy(); // no game before it to wait on
    expect(picks().getByRole('heading', { name: 'Pick 2 for game 1' }).parentElement?.querySelector('strong.num')?.textContent).toBe('0 of 2');
    expect(picks().getAllByRole('button', { pressed: false }).map((b) => b.querySelector('b')?.textContent)).toEqual(['Alex', 'Arlo', 'Ash', 'Avery']); // A→Z
    fireEvent.click(pickRow('Alex'));
    await waitFor(() => expect(api.setGamePick).toHaveBeenLastCalledWith('m1', 'S1', 1, ['a3']));
    await waitFor(() => expect(rowsBusy()).toBe('false')); // reloaded
    expect(picks().getByText('1 of 2')).toBeTruthy();
    fireEvent.click(pickRow('Ash'));
    await waitFor(() => expect(api.setGamePick).toHaveBeenLastCalledWith('m1', 'S1', 1, ['a3', 'a1']));
    await waitFor(() => expect(rowsBusy()).toBe('false'));
    expect(picks().getAllByRole('button', { pressed: true })).toHaveLength(2);
    expect(picks().getByText('2 of 2')).toBeTruthy();
    expect(pickRow('Avery').disabled).toBe(true);
    expect(picks().getByText('You have 2 picks. Clear one to change.')).toBeTruthy();
    // Clearing Alex (rows list by name) sends Ash alone.
    fireEvent.click(picks().getAllByRole('button', { pressed: true })[0]);
    await waitFor(() => expect(api.setGamePick).toHaveBeenLastCalledWith('m1', 'S1', 1, ['a1']));
    expect(screen.queryByRole('button', { name: /^Bench / })).toBeNull(); // no bench any more (C3)
  });

  it('lets you pick game 2 while game 1 is live, before game 2 is paired (B1)', async () => {
    const r = liveGame1();
    await show({ ...r, pairings: r.pairings.filter((p) => p.game_id !== 'g2') });
    const ash = picks().getByRole('button', { name: /^Ash\b/, pressed: false });
    expect(picks().getByText("You'll see who you play once game 1 ends. Picks lock when a keeper starts game 2.")).toBeTruthy();
    expect(picks().queryByText(/You start next game|joined after/)).toBeNull();
    fireEvent.click(ash);
    await waitFor(() => expect(api.setGamePick).toHaveBeenLastCalledWith('m1', 'S1', 2, ['a1']));
  });

  it('says a bye plainly', async () => {
    const r = afterGame1();
    // Three teams: Flow plays Huck in game 2, Zeal has the bye.
    await show({
      ...r,
      members: [...r.members, { id: 'm3', team_name: 'Huck', created_at: '2026-10-01T00:00:00Z', removed_at: null }],
      slots: [...r.slots, ...roster('m3', ['c1'])],
      athletes: [...r.athletes, { id: 'c1', name: 'Cy' }],
      pairings: [r.pairings[0], { game_id: 'g2', home: 'm1', away: null }, { game_id: 'g2', home: 'm2', away: 'm3' }],
    });
    expect(picks().getByText("Bye in game 2: no opponent, so your standings points don't change.")).toBeTruthy();
    expect(picks().getAllByRole('button', { pressed: false })).toHaveLength(4); // a bye start still tires a player: you can pick
  });

  it('says a team with no players cannot score', async () => {
    await show({ ...base(), slots: roster('m2', ['b1', 'b2', 'b3', 'b4']) });
    expect(picks().getByText("You have no players this tournament, so you can't score.")).toBeTruthy();
    expect(picks().queryByRole('button')).toBeNull();
    expect(document.body.textContent).not.toMatch(/forfeit/i);
  });

  it('says a team paired after it joined starts the game after', async () => {
    const r = afterGame1();
    await show({ ...r, pairings: r.pairings.map((p) => (p.game_id === 'g2' ? { ...p, home: 'm2', away: null } : p)) });
    expect(picks().getByText('You joined after game 2 was paired, so you start the game after it.')).toBeTruthy();
    expect(picks().queryByRole('button')).toBeNull();
  });

  it('shows each player as a row with your share and tiredness in words', async () => {
    await show(afterGame1());
    const ash = pickRow('Ash');
    expect(ash.matches('button.pick-row[aria-pressed="false"]')).toBe(true);
    expect([...ash.children].map((el) => el.className)).toEqual(['who', 'ring']);
    expect(ash.querySelector('.who > small')?.textContent).toBe('Your 100% · played game 1: half points'); // base fixture shares are 1
    expect(pickRow('Alex').textContent).toContain('Your 100% · rested'); // Avery was game 1's auto-pick, so tired too
  });

  it('toggles a pick by tapping the row, and keeps an Out pick clearable', async () => {
    const r = afterGame1();
    await show({
      ...r,
      picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a2' },
        { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a3' }],
      outs: [{ stage_id: 'S1', athlete_id: 'a2', from_game: 2, until_game: null },
        { stage_id: 'S1', athlete_id: 'a4', from_game: 2, until_game: null }],
    });
    // Avery: picked and Out, so still on (and clearable). Arlo: Out and not picked, so off.
    expect(pickRow('Avery').getAttribute('aria-pressed')).toBe('true');
    expect(pickRow('Avery').disabled).toBe(false);
    expect(pickRow('Avery').textContent).toContain('Out');
    expect(pickRow('Arlo').getAttribute('aria-pressed')).toBe('false');
    expect(pickRow('Arlo').disabled).toBe(true);
    expect(pickRow('Arlo').textContent).toContain('Out');
    fireEvent.click(pickRow('Alex'));
    await waitFor(() => expect(api.setGamePick).toHaveBeenLastCalledWith('m1', 'S1', 2, ['a2']));
    await waitFor(() => expect(rowsBusy()).toBe('false'));
    expect(pickRow('Alex').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pickRow('Avery'));
    await waitFor(() => expect(api.setGamePick).toHaveBeenLastCalledWith('m1', 'S1', 2, []));
  });

  it('shows a tap at once and holds a second tap until the reload lands, so the first pick is never lost', async () => {
    await show(base());
    let land = () => {};
    vi.mocked(loadLeagueTournament).mockImplementationOnce(() => new Promise((ok) => {
      land = () => ok(buildLeagueTournament(rows.current, Date.parse('2026-11-07T16:30:00Z')));
    }));
    fireEvent.click(pickRow('Alex'));
    await waitFor(() => expect(loadLeagueTournament).toHaveBeenCalledTimes(2)); // saved; the reload is in flight
    expect(pickRow('Alex').getAttribute('aria-pressed')).toBe('true'); // the ring fills on the tap, not on the reload
    expect(picks().getByText('1 of 2')).toBeTruthy();
    fireEvent.click(pickRow('Ash')); // the old picks are still loaded: this tap must not send them
    expect(rowsBusy()).toBe('true');
    land();
    await waitFor(() => expect(rowsBusy()).toBe('false'));
    fireEvent.click(pickRow('Ash'));
    await waitFor(() => expect(api.setGamePick).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.setGamePick).mock.calls.map((c) => c[3])).toEqual([['a3'], ['a3', 'a1']]);
  });

  it('keeps a saved pick when the reload after it fails, so the next tap builds on it (weak signal)', async () => {
    await show(base());
    vi.mocked(loadLeagueTournament).mockRejectedValueOnce(new Error('Failed to fetch'));
    fireEvent.click(pickRow('Alex'));
    await waitFor(() => expect(rowsBusy()).toBe('false')); // saved; the reload failed
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(pickRow('Alex').getAttribute('aria-pressed')).toBe('true'); // the saved set, not the stale loaded one
    expect(picks().getByText('1 of 2')).toBeTruthy();
    fireEvent.click(pickRow('Ash'));
    await waitFor(() => expect(api.setGamePick).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.setGamePick).mock.calls.map((c) => c[3])).toEqual([['a3'], ['a3', 'a1']]);
    await waitFor(() => expect(rowsBusy()).toBe('false')); // this reload lands: fresh data replaces the held set
    expect(picks().getAllByRole('button', { pressed: true }).map((b) => b.querySelector('b')?.textContent)).toEqual(['Alex', 'Ash']);
  });

  it("shows each player's share, tiredness and earlier tournaments in words (decision 11)", async () => {
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
    const words = (name: string) => pickRow(name).querySelector('small')?.textContent;
    // Ash: half of him, started last game (x0.5), started in the opener (x0.9).
    expect(words('Ash')).toBe('Your 50% · played game 1: half points · earlier tournaments: 90%');
    expect(words('Arlo')).toBe('Your 100% · rested'); // x1 earlier tournaments is left out
    expect(words('Alex')).toBe('Your 40% · rested');
  });

  it("words a half share of last game's starter as both parts", async () => {
    const r = afterGame1();
    await show({ ...r, slots: [...roster('m1', ['a1', 'a2', 'a3', 'a4'], [0.5, 1, 1, 1]), ...roster('m2', ['b1', 'b2', 'b3', 'b4'])] });
    expect(pickRow('Ash').textContent).toContain('Your 50% · played game 1: half points');
  });

  it('names who plays for an Out pick, and says when an Out pick still plays', async () => {
    const r = afterGame1();
    await show({
      ...r,
      picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a2' },
        { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a3' }],
      outs: [{ stage_id: 'S1', athlete_id: 'a2', from_game: 2, until_game: null }],
    });
    // Arlo is the most rested healthy player left (Ash started game 1). Hint text, never a box in the card (ruling 7).
    expect(picks().getByText('Avery is out. Arlo plays.').matches('p.hint')).toBe(true);
    expect(screen.getByRole('article', { name: 'Next game' }).querySelector('.notice')).toBeNull();
    cleanup();
    // A one-player team: nobody else is free, so the Out pick plays anyway. Not a swap.
    await show({
      ...r,
      slots: [...roster('m1', ['a1']), ...roster('m2', ['b1', 'b2'])],
      picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a1' }],
      outs: [{ stage_id: 'S1', athlete_id: 'a1', from_game: 2, until_game: null }],
    });
    expect(picks().getByText('Ash is out and still plays: nobody else is free.')).toBeTruthy();
    expect(picks().queryByText(/Ash plays/)).toBeNull();
  });

  it('does not call a swap "still plays" when a spare came in for one Out pick and an Out pick filled the other', async () => {
    const r = afterGame1();
    // Ash and Avery are both picked and Out; Alex is the only free spare. The core pairs Ash->Alex and Avery->Ash.
    await show({
      ...r,
      slots: [...roster('m1', ['a1', 'a2', 'a3']), ...roster('m2', ['b1', 'b2', 'b3', 'b4'])],
      picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a1' },
        { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a2' }],
      outs: [{ stage_id: 'S1', athlete_id: 'a1', from_game: 2, until_game: null },
        { stage_id: 'S1', athlete_id: 'a2', from_game: 2, until_game: null }],
    });
    expect(picks().queryByText(/still plays/)).toBeNull();
    expect(picks().getByText('Ash is out. Alex plays.')).toBeTruthy();
  });

  it('disables an Out player and shows the Out pill', async () => {
    const r = afterGame1();
    await show({ ...r, outs: [{ stage_id: 'S1', athlete_id: 'a2', from_game: 2, until_game: null }] });
    const row = pickRow('Avery');
    expect(row.querySelector('.pill.bad')?.textContent).toBe('Out');
    expect(row.textContent).not.toContain('Injured');
    expect(row.disabled).toBe(true);
    expect(pickRow('Alex').disabled).toBe(false);
  });

  it('keeps a saved pick who is now out clearable, with the out notice', async () => {
    const r = afterGame1();
    await show({
      ...r,
      picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a2' },
        { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a3' }],
      outs: [{ stage_id: 'S1', athlete_id: 'a2', from_game: 2, until_game: null }],
    });
    expect(pickRow('Avery').getAttribute('aria-pressed')).toBe('true');
    expect(pickRow('Avery').disabled).toBe(false);
    expect(picks().getByText('Avery is out. Arlo plays.')).toBeTruthy();
    expect(screen.getByText('Your pick is out')).toBeTruthy();
  });

  it('words a past swap as out', async () => {
    const r = afterGame1();
    await show({
      ...r,
      games: r.games.map((g) => (g.id === 'g2' ? { ...g, session_id: 'p2', started_at: '2026-11-07T16:00:00Z' } : g)),
      sessions: [...r.sessions, { id: 'p2', verified_at: null }],
      picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a2' },
        { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a3' },
        { stage_id: 'S1', game_number: 2, membership_id: 'm2', athlete_id: 'b2' }],
      outs: [{ stage_id: 'S1', athlete_id: 'a2', from_game: 2, until_game: null }],
    });
    expect(within(screen.getByRole('region', { name: 'Starters' })).getByText('Avery was out, so Arlo played.')).toBeTruthy();
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
    expect(screen.getByRole('heading', { name: 'Pick 2 for game 2' })).toBeTruthy();
    expect(screen.getByText(/^You play/).textContent).toBe('You play Flow.');
    expect(picks().getByText('Picks lock when a keeper starts game 2.')).toBeTruthy();
    expect(pickRow('Ash').textContent).toContain('played game 1: half points');
    // The header leads with the next matchup; neither side's picks are set, and theirs read as hidden.
    expect(screen.getByRole('heading', { name: 'Zeal vs Flow' })).toBeTruthy();
    expect(screen.getByText('No picks yet')).toBeTruthy();
    expect(screen.getByText('Hidden')).toBeTruthy();
    // Blake and Bryn (rested) are who the scorer would auto-pick for Flow: shown nowhere until game 2 starts.
    expect(document.body.textContent).not.toContain('Blake');
    expect(document.body.textContent).not.toContain('Bryn');
    expect(screen.getByText('Finished · not verified')).toBeTruthy(); // game 1's line
  });

  it('has nothing to pick between tournaments (T4)', async () => {
    // No games and no playing stage: the next auction hasn't run.
    await show({ ...base(), stages: [{ ...base().stages[0], auction_run_at: null }] });
    expect(document.querySelector('.strip')?.textContent).toContain('No games yet');
    expect(screen.queryByRole('heading', { name: 'Games' })).toBeNull(); // nothing played: no empty section
    expect(screen.queryByRole('article', { name: 'Next game' })).toBeNull();
  });

  describe('league table (ruling 8)', () => {
    const table = () => within(screen.getByRole('article', { name: 'League A' }));

    it('shows a short league table with Full table instead of the tiles', async () => {
      const r = finalGame1();
      // Flow beat Zeal; four more teams (no players) played each other: six rows, Zeal last.
      const more = ['m3', 'm4', 'm5', 'm6'];
      await show({
        ...r,
        members: [...r.members, ...more.map((id) => ({ id, team_name: `Team ${id}`, created_at: '2026-10-01T00:00:00Z', removed_at: null }))],
        pairings: [...r.pairings, { game_id: 'g1', home: 'm3', away: 'm4' }, { game_id: 'g1', home: 'm5', away: 'm6' }],
        lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 1 }, points_played: 0 },
          { session_id: 'p1', athlete_id: 'b1', stats: { goal: 2 }, points_played: 0 }],
      });
      // The top 3, one gap, then the row above yours and yours.
      expect(table().getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent ?? li.textContent))
        .toEqual(['Flow', expect.stringMatching(/^Team m/), expect.stringMatching(/^Team m/), '1 more team', expect.stringMatching(/^Team m/), 'Zeal (you)']);
      expect(document.querySelector('.ranks [aria-current]')?.textContent).toContain('Zeal (you)');
      expect(table().getByRole('link', { name: 'Full table' }).getAttribute('href')).toBe('/leaderboards');
      expect(table().queryByRole('button', { name: /Show all/ })).toBeNull();
      expect(screen.queryByText('Place')).toBeNull();
      expect(screen.queryByText('Record')).toBeNull();
    });

    it('says standings start after the first game before any game counts', async () => {
      await show(afterGame1()); // game 1 finished, not verified: nothing counts yet
      expect(table().getByText('Standings start after the first game.')).toBeTruthy();
      expect(table().queryByRole('list')).toBeNull();
      expect(table().queryByRole('link', { name: 'Full table' })).toBeNull(); // nothing to open yet
      // After the pick card, before the games.
      const [next, league, games] = [screen.getByRole('article', { name: 'Next game' }), screen.getByRole('article', { name: 'League A' }),
        screen.getByRole('region', { name: 'Zeal games' })];
      expect(next.compareDocumentPosition(league) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(league.compareDocumentPosition(games) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('games list', () => {
    const lines = () => [...document.querySelectorAll('.game-line')];
    /** A game line as [number, each team row's [name, score], the state's words]. */
    const words = (el: Element) => [
      el.querySelector('.n')?.textContent,
      [...el.querySelectorAll('.t')].map((t) => [...t.children].map((c) => c.textContent)),
      [...el.querySelector('.state')!.children].map((c) => c.textContent),
    ];
    const region = () => within(screen.getByRole('region', { name: 'Zeal games' })); // named after the team (t130)
    /** What a row opens to: its details' body, after the summary. */
    const body = (el: Element) => el.closest('details')!.querySelector(':scope > :not(summary)')!;
    const stage = (id: string, name: string, day: string) =>
      ({ ...base().stages[0], id, name, starts_on: `2026-10-${day}`, ends_on: `2026-10-${day}` });
    const played = (id: string, stage_id: string, day: string, session_id: string) =>
      ({ id, stage_id, number: 1, session_id, started_at: `2026-10-${day}T14:00:00Z`, finished_at: `2026-10-${day}T15:00:00Z`, opponent: null });

    it('lists every game of the current tournament on one line each, yours first', async () => {
      const r = finalGame1();
      const g3 = { id: 'g3', stage_id: 'S1', number: 3, session_id: null, started_at: null, finished_at: null, opponent: null };
      const three: TournamentRows = {
        ...r,
        stages: base().stages, // still on: game 3 is next
        games: [...r.games, { ...g3, id: 'g2', number: 2, session_id: 'p2', started_at: '2026-11-07T16:00:00Z' }, g3],
        // Flow is home in game 1: your team still comes first.
        pairings: [{ game_id: 'g1', home: 'm2', away: 'm1' }, { game_id: 'g2', home: 'm1', away: 'm2' }],
        sessions: [...r.sessions, { id: 'p2', verified_at: null }],
      };
      await show(three);
      expect(screen.getByRole('heading', { name: 'Games' })).toBeTruthy();
      expect(region().getByText('Fall beta').matches('.game-group > p')).toBe(true);
      expect(lines().map(words)).toEqual([
        ['Game 1', [['Zeal', '6'], ['Flow', '3']], ['Final']],
        ['Game 2', [['Zeal', '0'], ['Flow', '0']], ['Live', 'unofficial']],
        ['Game 3', [['Not paired yet']], ['Pick 2']],
      ]);
      expect(lines()[0].querySelector('.t.lost')?.textContent).toBe('Flow3');
      expect(lines()[1].querySelector('.state .live > .dot')).toBeTruthy();
      expect(lines()[2].querySelector('.state')?.matches('.go')).toBe(true); // gold: the one thing to do
      // Played games open (the row is the button); a game not started has nothing to open.
      expect(lines().map((l) => l.tagName)).toEqual(['SUMMARY', 'SUMMARY', 'DIV']);
      cleanup();
      // One pick made: one to go. Both made: the step is done, so it becomes the status word.
      const pick = (athlete_id: string) => ({ stage_id: 'S1', game_number: 3, membership_id: 'm1', athlete_id });
      await show({ ...three, picks: [...three.picks, pick('a2')] });
      expect(words(lines()[2])[2]).toEqual(['Pick 1']);
      cleanup();
      await show({ ...three, picks: [...three.picks, pick('a2'), pick('a3')] });
      expect(words(lines()[2])[2]).toEqual(['Not started']);
      expect(lines()[2].querySelector('.state')?.matches('.go')).toBe(false);
    });

    it('folds earlier tournaments you played into one row and leaves out ones you did not', async () => {
      const r = afterGame1();
      await show({
        ...r,
        // Opener: Zeal beat Flow. Warmup: only Flow, with a bye.
        stages: [stage('S0', 'Opener', '03'), stage('S9', 'Warmup', '10'), ...r.stages],
        games: [played('g0', 'S0', '03', 'p0'), played('g9', 'S9', '10', 'p9'), ...r.games],
        pairings: [{ game_id: 'g0', home: 'm1', away: 'm2' }, { game_id: 'g9', home: 'm2', away: null }, ...r.pairings],
        slots: [...r.slots, ...[['m1', 'a1'], ['m2', 'b1']].map(([membership_id, athlete_id]) =>
          ({ stage_id: 'S0', membership_id, athlete_id, price: 10, share: 1, from_game: 1, until_game: null }))],
        sessions: [{ id: 'p0', verified_at: '2026-10-03T16:00:00Z' }, { id: 'p9', verified_at: '2026-10-10T16:00:00Z' }, ...r.sessions],
        lines: [{ session_id: 'p0', athlete_id: 'a1', stats: { goal: 2 }, points_played: 0 }],
      });
      expect([...document.querySelectorAll('.game-group > p')].map((p) => p.textContent)).toEqual(['Fall beta', 'Earlier']);
      const opener = region().getByText('Opener · 1 game · 1–0');
      expect(opener.closest('summary')).toBeTruthy(); // the whole row opens it
      expect(screen.getByRole('region', { name: 'Zeal games' }).textContent).not.toContain('Warmup');
      // Opened, it lists that tournament's games, one line each.
      expect(words(body(opener).querySelector('.game-line')!)).toEqual(['Game 1', [['Zeal', '6'], ['Flow', '0']], ['Final']]);
    });

    it('notes a final game held back by an earlier unverified game', async () => {
      const r = finalGame1();
      await show({
        ...r,
        stages: [stage('S0', 'Warmup', '03'), ...r.stages],
        games: [played('g0', 'S0', '03', 'p0'), ...r.games],
        pairings: [{ game_id: 'g0', home: 'm1', away: 'm2' }, ...r.pairings],
        sessions: [{ id: 'p0', verified_at: null }, ...r.sessions], // Warmup's game was never verified
      });
      const line = region().getByText('Fall beta').parentElement!.querySelector('.game-line')!;
      // Its stats are verified, so Final (not unofficial), with when it counts.
      expect(words(line)).toEqual(['Game 1', [['Zeal', '6'], ['Flow', '3']], ['Final']]);
      expect(line.querySelector('.teams > small')?.textContent).toBe('counts once Warmup game 1 is verified');
      const opened = body(line);
      expect(opened.querySelector('li small')?.textContent).toBe('Ash · 2 goals');
      expect(opened.textContent).not.toMatch(/no stats yet|nofficial/);
    });

    it('opens a game to your matchup first, then other matchups one line each', async () => {
      const r = finalGame1();
      const team = (id: string, team_name: string) => ({ id, team_name, created_at: '2026-10-01T00:00:00Z', removed_at: null });
      await show({
        ...r,
        members: [...r.members, team('m3', 'Huck Finn'), team('m4', 'Layout Legends')],
        // Zeal owns half of Ash.
        slots: [...roster('m1', ['a1', 'a2', 'a3', 'a4'], [0.5, 1, 1, 1]), ...roster('m2', ['b1', 'b2', 'b3', 'b4']), ...roster('m3', ['c1']), ...roster('m4', ['d1'])],
        athletes: [...r.athletes, { id: 'c1', name: 'Cy' }, { id: 'd1', name: 'Dee' }],
        pairings: [{ game_id: 'g1', home: 'm2', away: 'm1' }, { game_id: 'g1', home: 'm3', away: 'm4' }],
        lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 3, turnover: 2 }, points_played: 0 }, ...r.lines.slice(1),
          { session_id: 'p1', athlete_id: 'c1', stats: { assist: 1 }, points_played: 0 }, { session_id: 'p1', athlete_id: 'd1', stats: { block: 1 }, points_played: 0 }],
      });
      const opened = body(lines()[0]);
      // Yours first, though Flow was home; then the other matchup as one line that opens to its two sides.
      expect([...opened.querySelectorAll(':scope > .stack .by')].map((el) => el.textContent)).toEqual(['Zeal', 'Flow']);
      const other = within(opened as HTMLElement).getByRole('heading', { name: 'Other matchups' }).parentElement!;
      expect([...other.querySelectorAll(':scope > details > summary')].map((s) => s.textContent)).toEqual(['Huck Finn 3 · Layout Legends 5']);
      expect([...other.querySelectorAll('details .by')].map((el) => el.textContent)).toEqual(['Huck Finn', 'Layout Legends']);
      // 3 goals x 3 - 2 turnovers x 1 = 7, at half of Ash.
      const li = (name: string) => [...opened.querySelectorAll(':scope > .stack li')].find((x) => x.textContent?.startsWith(name))!;
      expect(li('Ash').querySelector('small')?.textContent).toBe('Ash · 3 goals, 2 turnovers');
      expect(li('Ash').querySelector('strong.calc')?.textContent).toBe('7 × 50% = 3.5');
      // Zeal's auto-picked starter has no stat line: nothing to multiply (controller rulings 13, 14).
      const auto = [...opened.querySelectorAll(':scope > .stack:first-child li')].find((x) => !x.textContent?.startsWith('Ash'))!;
      expect(auto.querySelector('small')?.textContent).toMatch(/^\w+ · didn't play$/);
      expect(auto.querySelector('strong')?.textContent).toBe('0');
      expect(opened.textContent).toContain("You didn't pick, so");
      expect(opened.textContent).toContain("Flow didn't pick, so"); // not "You": the viewer is Zeal
    });

    it("reads Bye and Doesn't count", async () => {
      const r = finalGame1();
      await show({
        ...r,
        slots: roster('m2', ['b1', 'b2', 'b3', 'b4']), // Zeal bought nothing (Review Focus 2)
        // Game 1: Zeal's bye. Game 2: its tally was deleted.
        games: [...r.games, { ...r.games[0], id: 'g2', number: 2, session_id: null, started_at: '2026-11-04T14:00:00Z', finished_at: '2026-11-04T15:00:00Z' }],
        pairings: [{ game_id: 'g1', home: 'm1', away: null }, { game_id: 'g2', home: 'm1', away: 'm2' }],
      });
      expect(lines().map(words)).toEqual([
        ['Game 1', [['Zeal', '0'], ['Bye']], ['Final']],
        ['Game 2', [['Zeal'], ['Flow']], ["Doesn't count"]],
      ]);
      expect(lines()[1].tagName).toBe('DIV'); // a void game has nothing to open
      expect(body(lines()[0]).textContent).toBe('Zeal0No playersBye'); // a bye still scores its starters: none
      expect(document.body.textContent).not.toMatch(/forfeit/i);
    });

    it('reads No starters for a side whose players all sat out, never Forfeit (it can still tie or win)', async () => {
      const r = finalGame1();
      // Zeal made no pick and the season starts nobody for a missed pick.
      await show({ ...r, settings: { default_pick: 'forfeit' }, picks: r.picks.filter((p) => p.membership_id === 'm2') });
      const opened = body(lines()[0]);
      expect(opened.querySelector('.stack > .stack')!.textContent).toContain('No starters');
      expect(screen.getByText('You played').parentElement!.textContent).toContain('No starters'); // the scoreboard
      expect(screen.getByRole('region', { name: 'Starters' }).textContent).toContain('No starters');
      expect(document.body.textContent).not.toMatch(/forfeit|No players/i);
    });

    it('reads No players for a paired side with no roster this tournament', async () => {
      const r = finalGame1();
      await show({ ...r, slots: roster('m2', ['b1', 'b2', 'b3', 'b4']), picks: r.picks.filter((p) => p.membership_id === 'm2') });
      expect(body(lines()[0]).querySelector('.stack > .stack')!.textContent).toContain('No players');
      expect(document.body.textContent).not.toMatch(/forfeit|No starters/i);
    });

    it("says Not playing when the team wasn't paired in that game", async () => {
      const r = afterGame1();
      await show({ ...r, pairings: r.pairings.map((p) => (p.game_id === 'g1' ? { ...p, home: 'm2', away: null } : p)) });
      expect(words(lines()[0])[1]).toEqual([['Not playing']]);
      // Opened, every matchup is another team's, a bye included.
      expect([...body(lines()[0]).querySelectorAll('summary')].map((s) => s.textContent)).toEqual(['Flow 0 · Bye']);
    });

    it('keeps a long team name and an emoji name on the line with both scores', async () => {
      const r = finalGame1();
      await show({ ...r, members: [{ ...r.members[0], team_name: 'Selling Zeal Stock' }, { ...r.members[1], team_name: 'Money 🤑' }] });
      expect(words(lines()[0])).toEqual(['Game 1', [['Selling Zeal Stock', '6'], ['Money 🤑', '3']], ['Final']]);
    });

    describe('an earlier tournament left live', () => {
      const groups = () => [...screen.getByRole('region', { name: 'Zeal games' }).querySelectorAll(':scope > .game-group')];
      const heads = () => groups().map((g) => g.querySelector(':scope > p')?.textContent);
      const folded = (g: Element) => [...g.querySelectorAll(':scope > details > summary')].map((s) => s.textContent);
      const strip = () => document.querySelector('.matchup .strip')!.textContent!;

      it('takes the matchup from the current tournament, not a game an earlier one left live', async () => {
        await show(staleAndCurrent());
        expect(strip()).toContain('Game 1');
        expect(strip()).toContain('Live');
        expect(strip()).not.toContain('Game 4');
        expect(document.querySelector('.score .pts')?.textContent).toBe('6'); // Ash's 2 goals
      });

      it('says Bye for the current live game, not a game an earlier tournament left live (what users saw)', async () => {
        const r = staleAndCurrent();
        // Three teams: Zeal has the bye in Fall beta's live game 1, Flow plays Huck.
        await show({
          ...r,
          members: [...r.members, { id: 'm3', team_name: 'Huck', created_at: '2026-10-01T00:00:00Z', removed_at: null }],
          slots: [...r.slots, ...roster('m3', ['c1'])],
          athletes: [...r.athletes, { id: 'c1', name: 'Cy' }],
          pairings: r.pairings.flatMap((p) => (p.game_id === 'g1' ? [{ ...p, away: null }, { game_id: 'g1', home: 'm2', away: 'm3' }] : [p])),
        });
        expect(strip()).toContain('Game 1');
        expect(strip()).toContain('Bye');
        expect(strip()).not.toContain('Game 4');
        expect(document.querySelector('.score')).toBeNull();
      });

      it('folds the earlier tournament under Earlier, not into the current games', async () => {
        await show(staleAndCurrent());
        expect(heads()).toEqual(['Fall beta', 'Earlier']);
        expect([...groups()[0].querySelectorAll('.game-line .n')].map((n) => n.textContent)).toEqual(['Game 1', 'Game 2']);
        expect(folded(groups()[1])).toEqual(['Feasterns · 1 game · 0–0']);
      });

      it('shows no game in the strip between tournaments', async () => {
        await show(staleBetween());
        expect(strip()).toContain('League A');
        expect(strip()).toContain('2 teams');
        expect(strip()).not.toContain('Game');
        expect(heads()).toEqual(['Earlier']);
        expect(folded(groups()[0])).toEqual(['Feasterns · 1 game · 0–0']);
      });
    });

    it('lists nothing before the tournament opens and no earlier tournament was played', async () => {
      await show(base()); // the tournament's games aren't made yet
      expect(screen.queryByRole('heading', { name: 'Games' })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Zeal games' })).toBeNull();
      expect(document.querySelector('.game-line')).toBeNull();
    });
  });

  it('marks a game whose tally was deleted as void', async () => {
    const r = afterGame1();
    await show({ ...r, games: r.games.map((g) => (g.id === 'g1' ? { ...g, session_id: null } : g)), sessions: [] });
    expect(document.querySelector('.game-line .state')?.textContent).toBe("Doesn't count");
    // A void start doesn't tire anyone.
    expect(pickRow('Ash').textContent).toContain('Your 100% · rested');
  });

  describe('matchup header', () => {
    const scoreboard = () => document.querySelector('.score');
    const strip = () => document.querySelector('.strip') as HTMLElement;
    /** The strip's words, left to right, without the "?" and its popover text. */
    const stripWords = () => [...strip().children].filter((e) => !e.matches('.help, .help-pop')).map((e) => e.textContent);

    it('reads one line: game, status word and dot, "unofficial" and its ?', async () => {
      await show(liveGame1());
      expect(stripWords()).toEqual(['Game 1', 'Live', 'unofficial']);
      expect(strip().querySelector('.live > .dot')).toBeTruthy();
      expect(within(strip()).getByRole('button', { name: 'What unofficial and verified mean' })).toBeTruthy();
      expect(strip().querySelector('.chip, .pill.warn')).toBeNull();
      expect(strip().textContent).not.toContain('Fall beta');
    });

    it('says Final with Won and the points once verified', async () => {
      await show(finalGame1());
      expect(stripWords()).toEqual(['Game 1', 'Final', expect.stringMatching(/^Won \+\d/)]);
      expect(scoreboard()?.querySelector(':scope > .vs')?.textContent).toBe('vs'); // never "to" (ruling 2)
    });

    it('says a verified game held back by an unverified one is Final, and when it counts', async () => {
      const r = afterGame1(); // game 1 finished, not verified
      await show({
        ...r,
        games: r.games.map((g) => (g.id === 'g2' ? { ...g, session_id: 'p2', started_at: '2026-11-07T15:10:00Z', finished_at: '2026-11-07T16:00:00Z' } : g)),
        sessions: [...r.sessions, { id: 'p2', verified_at: '2026-11-07T16:10:00Z' }],
      });
      expect(stripWords()).toEqual(['Game 2', 'Final', 'counts once Fall beta game 1 is verified']);
    });

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
      expect(within(strip()).getByText('Live')).toBeTruthy(); // the game's line says it too
      expect(scoreboard()?.textContent).toContain('Avery');
      expect(scoreboard()?.textContent).toContain('Quinn'); // revealed: the game has started
      expect(scoreboard()?.textContent).toContain('They played');
    });

    it('between tournaments, folds the last tournament under Earlier and keeps the record in the table (X1)', async () => {
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
      // The strip is the league line, with no game from a tournament that's over (DECISION 2).
      expect(stripWords()).toEqual(['League A', '2 teams']);
      expect(scoreboard()).toBeNull();
      const games = screen.getByRole('region', { name: 'Zeal games' });
      expect([...games.querySelectorAll(':scope > .game-group > p')].map((p) => p.textContent)).toEqual(['Earlier']);
      expect(within(games).getByText('Fall beta · 1 game · 1–0').closest('summary')).toBeTruthy();
      expect(games.querySelector('.game-line .t.lost')?.textContent).toBe('Flow3'); // opened, the loser greyed
      expect(document.querySelector('.ranks [aria-current] small')?.textContent).toBe('1–0');
    });

    it('says Bye and shows no scoreboard when the team sits out', async () => {
      const r = afterGame1();
      await show({ ...r, pairings: r.pairings.map((p) => (p.game_id === 'g2' ? { ...p, away: null } : p)) });
      expect(document.querySelector('.strip')?.textContent).toContain('Bye');
      expect(scoreboard()).toBeNull();
    });

    it("doesn't show an Out pick as set", async () => {
      const r = afterGame1();
      await show({
        ...r,
        picks: [...r.picks, { stage_id: 'S1', game_number: 2, membership_id: 'm1', athlete_id: 'a2' }],
        outs: [{ stage_id: 'S1', athlete_id: 'a2', from_game: 2, until_game: null }],
      });
      expect(screen.getByText('Your pick is out')).toBeTruthy();
      expect(document.querySelector('.score-side.picked')).toBeNull();
    });
  });

  it('explains how points count on the pick card', async () => {
    await show(afterGame1());
    const help = picks().getByRole('button', { name: "How a player's points count" });
    expect(help.nextElementSibling!.textContent).toContain('If he started the game before, they count half');
  });

  describe('live scores (t317)', () => {
    const starters = () => [...document.querySelectorAll('.starters li')].map((li) => li.textContent);

    it("shows a live game's unofficial score", async () => {
      await show(liveGame1());
      const strip = document.querySelector('.strip')!.textContent!;
      expect(strip).toContain('Live');
      expect(strip).toContain('unofficial');
      expect([...document.querySelectorAll('.score .pts')].map((e) => e.textContent)).toEqual(['6', '5']);
    });

    /** A starter's line: the small words, then the points. */
    const starter = (name: string) => {
      const li = [...document.querySelectorAll('.starters li')].find((x) => x.textContent?.startsWith(name))!;
      return [li.querySelector('small')?.textContent, li.querySelector('strong')?.textContent];
    };

    it('writes starter lines as stats in words and base × exact share', async () => {
      await show(liveGame1());
      expect(starter('Ash')).toEqual(['Ash · 2 goals · 6 × 100%', '6']);
      expect(starter('Bea')).toEqual(['Bea · 1 block · 5 × 100%', '5']);
    });

    it('says no stats yet for a starter nobody has tapped', async () => {
      await show(liveGame1());
      // Each side's auto-picked 2nd starter: no taps, so nothing to multiply.
      expect(starters().filter((t) => t?.includes('no stats yet'))).toHaveLength(2);
      expect(starter('Avery')).toEqual(['Avery · no stats yet', '0']);
    });

    it('puts the auto-pick line under your starters, in the played wording', async () => {
      await show(liveGame1());
      const mine = document.querySelector('.starters > .stack')!;
      expect(mine.lastElementChild?.matches('p.hint')).toBe(true);
      expect(mine.lastElementChild?.textContent).toMatch(/^You didn't pick, so \w+ played\.$/);
    });

    it('explains unofficial beside the word, with no DOM nesting warning', async () => {
      const err = vi.spyOn(console, 'error');
      await show(liveGame1());
      const help = within(document.querySelector('.strip') as HTMLElement).getByRole('button', { name: 'What unofficial and verified mean' });
      expect(help.nextElementSibling!.textContent).toContain('reopened for 48 hours');
      expect(err.mock.calls.some((c) => /validateDOMNesting|cannot be a descendant/.test(String(c[0])))).toBe(false);
      err.mockRestore();
    });

    it('replaces live numbers with verified ones', async () => {
      const r = liveGame1();
      await show({
        ...r,
        games: r.games.filter((g) => g.id === 'g1').map((g) => ({ ...g, finished_at: '2026-11-07T15:00:00Z' })),
        pairings: r.pairings.filter((p) => p.game_id === 'g1'),
        sessions: [{ id: 'p1', verified_at: '2026-11-07T16:00:00Z' }],
        lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 1 }, points_played: 0 }, { session_id: 'p1', athlete_id: 'b1', stats: { block: 1 }, points_played: 0 }],
      });
      expect(document.querySelector('.strip')!.textContent).not.toMatch(/unofficial/i);
      expect([...document.querySelectorAll('.score .pts')].map((e) => e.textContent)).toEqual(['3', '5']);
      expect(document.querySelector('.strip')!.textContent).toMatch(/Lost −1/);
      expect(document.querySelector('.score-side.lost')!.textContent).toContain('Ash');
    });

    it('shows unofficial scores on a game line waiting on stats, with neither side greyed', async () => {
      const r = afterGame1();
      await show({ ...r, taps: TAPS.map((t) => ({ ...t })) });
      const line = document.querySelector('summary.game-line')!;
      expect([...line.querySelectorAll('.t')].map((t) => t.textContent)).toEqual(['Zeal6', 'Flow5']);
      expect(line.querySelector('.t.lost')).toBeNull(); // no result until it's verified
      expect([...line.querySelector('.state')!.children].map((e) => e.textContent)).toEqual(['Finished · not verified', 'unofficial']);
      const opened = line.closest('details')!;
      expect(opened.textContent).toContain('Unofficial until a keeper verifies.');
      expect(opened.textContent).toContain('Ash · 2 goals');
    });

    it('polls every 15 s while a game is live, not otherwise', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await show(liveGame1());
        expect(loadLeagueTournament).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(15_000);
        await waitFor(() => expect(loadLeagueTournament).toHaveBeenCalledTimes(2));
        cleanup();
        vi.mocked(loadLeagueTournament).mockClear();
        await show(base());
        await vi.advanceTimersByTimeAsync(30_000);
        expect(loadLeagueTournament).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('never polls for a game an earlier tournament left live (X1)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await show(staleBetween());
        await act(() => vi.advanceTimersByTimeAsync(30_000)); // a reload the poll asked for would land in here
        expect(loadLeagueTournament).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('loads live taps', async () => {
      await show(base());
      expect(loadLeagueTournament).toHaveBeenCalledWith('se', 'L', { live: true });
    });
  });

  describe('since you last looked (t319)', () => {
    const KEY = seenKey('m1', 'g1');
    const store = (v: unknown) => localStorage.setItem(KEY, JSON.stringify(v));
    const chips = () => [...document.querySelectorAll('.since')].map((e) => [e.textContent, e.className, e.closest('li')?.textContent]);
    const row = (name: string) => [...document.querySelectorAll('.starters li')].find((li) => li.textContent?.startsWith(name))!;

    it('shows +N on a player who scored since you last looked', async () => {
      store({ mine: 3, them: 5, points: { mine: { a1: 3 }, them: { b1: 5 } } });
      await show(liveGame1());
      // The chips are set by an effect after the load renders: wait for them.
      await waitFor(() => expect(row('Ash').querySelector('.since')?.textContent?.trim()).toBe('+3 since you last looked, now'));
      expect(row('Ash').querySelector('.since')!.className).toBe('since up');
      expect(row('Bea').querySelector('.since')).toBeNull();
      expect(chips()).toHaveLength(1);
      expect([...document.querySelectorAll('.score .pts')].map((e) => e.textContent)).toEqual(['6', '5']);
    });

    it('shows −N when verified numbers come in lower', async () => {
      store({ mine: 6, them: 5, points: { mine: { a1: 6 }, them: { b1: 5 } } });
      const r = liveGame1();
      await show({
        ...r,
        games: r.games.filter((g) => g.id === 'g1').map((g) => ({ ...g, finished_at: '2026-11-07T15:00:00Z' })),
        pairings: r.pairings.filter((p) => p.game_id === 'g1'),
        sessions: [{ id: 'p1', verified_at: '2026-11-07T16:00:00Z' }],
        lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 1 }, points_played: 0 }, { session_id: 'p1', athlete_id: 'b1', stats: { block: 1 }, points_played: 0 }],
      });
      await waitFor(() => expect(row('Ash').querySelector('.since')?.textContent?.trim()).toBe('−3 since you last looked, now'));
      expect(row('Ash').querySelector('.since')!.className).toBe('since down');
    });

    it('animates nothing on a first visit and remembers what it showed', async () => {
      await show(liveGame1());
      await waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull());
      expect(document.querySelector('.since')).toBeNull();
      expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ mine: 6, them: 5, points: { mine: { a1: 6 }, them: { b1: 5 } } });
    });

    it('renders without chips when storage is blocked', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
      try {
        await show(liveGame1());
        expect(document.querySelector('.starters')).toBeTruthy();
        expect(document.querySelector('.since')).toBeNull();
        expect(screen.queryByRole('alert')).toBeNull();
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('updates chips when a poll brings a change and keeps them when it does not', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await show(liveGame1());
        await waitFor(() => expect(localStorage.getItem(KEY)).not.toBeNull());
        expect(document.querySelector('.since')).toBeNull();
        rows.current = { ...rows.current, taps: [...rows.current.taps, tap('t4', 'a1', 'goal', '14:07')] };
        await vi.advanceTimersByTimeAsync(15_000);
        await waitFor(() => expect(row('Ash').querySelector('.since')?.textContent?.trim()).toBe('+3 since you last looked, now'));
        await vi.advanceTimersByTimeAsync(15_000);
        await waitFor(() => expect(loadLeagueTournament).toHaveBeenCalledTimes(3));
        expect(row('Ash').querySelector('.since')?.textContent?.trim()).toBe('+3 since you last looked, now');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
