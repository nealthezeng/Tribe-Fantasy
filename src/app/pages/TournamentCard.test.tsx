// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** Game 1 live (started 14:00, not finished): Ash scored twice (6), Bea blocked once (5). */
const tap = (id: string, athlete_id: string, stat: string, at: string) =>
  ({ id, session_id: 'p1', athlete_id, stat, keeper_id: 'k1', tapped_at: `2026-11-07T${at}:00Z`, undoes: null });
const TAPS = [tap('t1', 'a1', 'goal', '14:01'), tap('t2', 'a1', 'goal', '14:03'), tap('t3', 'b1', 'block', '14:05')];
const liveGame1 = (): TournamentRows => {
  const r = afterGame1();
  return { ...r, games: r.games.map((g) => (g.id === 'g1' ? { ...g, finished_at: null } : g)), taps: TAPS };
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
    expect(screen.getByRole('heading', { name: 'Pick 2 for game 2 vs Duke' })).toBeTruthy();
    expect(screen.getByText(/Game 1 vs UNC · Fall beta/)).toBeTruthy();
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
    expect(screen.getByText('Avery was out, so Arlo played.')).toBeTruthy();
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
    expect(screen.queryByRole('article', { name: 'Next game' })).toBeNull();
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
    expect(pickRow('Ash').textContent).toContain('Your 100% · rested');
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

  it('explains the × on the pick card', async () => {
    await show(afterGame1());
    const help = picks().getByRole('button', { name: 'What the × means' });
    expect(help.nextElementSibling!.textContent).toContain('Tired: ×0.5 if they started the game before');
  });

  describe('live scores (t317)', () => {
    const starters = () => [...document.querySelectorAll('.starters li')].map((li) => li.textContent);

    it("shows a live game's unofficial score and each starter's stat line", async () => {
      await show(liveGame1());
      const strip = document.querySelector('.strip')!.textContent!;
      expect(strip).toContain('Live');
      expect(strip).toContain('Unofficial');
      expect([...document.querySelectorAll('.score .pts')].map((e) => e.textContent)).toEqual(['6', '5']);
      expect(starters()).toContain('Ash · 2 Goal6');
      expect(starters()).toContain('Bea · 1 D5');
      expect(starters().filter((t) => t?.includes('No stats'))).toHaveLength(2); // each side's auto-picked 2nd starter
    });

    it('explains Unofficial beside the pill, with no DOM nesting warning', async () => {
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
        stages: [{ ...r.stages[0], ends_on: '2026-11-06' }], // over, so the verified game stays the focus
        games: r.games.filter((g) => g.id === 'g1').map((g) => ({ ...g, finished_at: '2026-11-07T15:00:00Z' })),
        pairings: r.pairings.filter((p) => p.game_id === 'g1'),
        sessions: [{ id: 'p1', verified_at: '2026-11-07T16:00:00Z' }],
        lines: [{ session_id: 'p1', athlete_id: 'a1', stats: { goal: 1 }, points_played: 0 }, { session_id: 'p1', athlete_id: 'b1', stats: { block: 1 }, points_played: 0 }],
      });
      expect(document.querySelector('.strip')!.textContent).not.toContain('Unofficial');
      expect([...document.querySelectorAll('.score .pts')].map((e) => e.textContent)).toEqual(['3', '5']);
      expect(document.querySelector('.strip')!.textContent).toMatch(/Lost −1/);
      expect(document.querySelector('.score-side.lost')!.textContent).toContain('Ash');
    });

    it('shows unofficial scores on a game card waiting on stats, without W/L', async () => {
      const r = afterGame1();
      await show({ ...r, taps: TAPS.map((t) => ({ ...t })) });
      const card = document.querySelector('.game')!;
      expect(card.querySelector('.game-score')!.textContent).toBe('Zeal6vsFlow5');
      expect(card.querySelector('summary > .meta')!.textContent).toContain('Waiting on stats');
      expect(card.querySelector('summary > .meta')!.textContent).toContain('Unofficial'); // labelled while closed too
      expect(card.querySelector('summary > .meta')!.textContent).not.toMatch(/W [+−]|L [+−]/);
      fireEvent.click(card.querySelector('summary')!);
      expect(card.textContent).toContain('Unofficial until a keeper verifies.');
      expect(card.textContent).toContain('Ash · 2 Goal');
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
        stages: [{ ...r.stages[0], ends_on: '2026-11-06' }],
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
