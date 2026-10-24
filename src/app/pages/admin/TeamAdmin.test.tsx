// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { buildLeagueTournament } from '../../lib/tournament';
import type { LeagueAdminData } from './LeagueBrowser';
import { TeamAdmin } from './TeamAdmin';

vi.mock('../../lib/rpc', () => ({ api: { adminSetShare: vi.fn(), adminRenameTeam: vi.fn() } }));

const NOW = Date.parse('2026-11-07T16:30:00Z');
const slot = (m: string, athlete_id: string, share: number) =>
  ({ stage_id: 'S1', membership_id: m, athlete_id, price: 10, share, from_game: 1, until_game: null });
const NAMES = ['Ash', 'Avery', 'Bea', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus'];

/** Gimp Zeal holds `held` players at 25% in stage S1 (roster_size 6); Money was removed. */
function data(held = 2, over: Partial<LeagueAdminData> = {}): LeagueAdminData {
  const athletes = NAMES.map((name, i) => ({ id: `a${i}`, name }));
  const y = buildLeagueTournament({
    settings: { roster_size: 6 },
    stages: [{ id: 'S1', name: 'S1', starts_on: '2026-11-01', ends_on: '2026-11-08', bid_close_at: '2026-11-03T00:00:00Z', auction_seed: null, auction_run_at: '2026-11-04T00:00:00Z' }],
    games: [{ id: 'g1', stage_id: 'S1', number: 1, session_id: null, started_at: null, finished_at: null, opponent: null }],
    pairings: [{ game_id: 'g1', home: 'm1', away: 'm2' }],
    members: [{ id: 'm1', team_name: 'Gimp Zeal', created_at: '2026-10-01T00:00:00Z', removed_at: null },
      { id: 'm2', team_name: 'Money', created_at: '2026-10-01T00:00:00Z', removed_at: '2026-11-05T00:00:00Z' }],
    slots: [...athletes.slice(0, held).map((a) => slot('m1', a.id, 0.25)), slot('m2', 'a7', 0.5)],
    picks: [], sessions: [], lines: [], taps: [], injuries: [], outs: [], athletes,
  }, NOW);
  return { leagueName: 'Huck Yeah', y, owners: new Map(), balances: new Map(), sealedBuys: [], players: athletes,
    stageId: 'S1', stageSettled: true, nextGame: 1, ...over };
}

beforeEach(() => vi.mocked(api.adminSetShare).mockResolvedValue(undefined as never));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('TeamAdmin', () => {
  it('adds a player at a percent', async () => {
    const changed = vi.fn();
    render(<TeamAdmin data={data()} membershipId="m1" onChanged={changed} />);
    fireEvent.change(screen.getByLabelText('Player'), { target: { value: 'a4' } });
    fireEvent.change(screen.getByLabelText('Share (%)'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.adminSetShare).toHaveBeenCalledWith('S1', 'm1', 'a4', 25));
    await waitFor(() => expect(changed).toHaveBeenCalled());
  });

  it('does not offer players the team already holds in the Add picker', () => {
    render(<TeamAdmin data={data()} membershipId="m1" onChanged={vi.fn()} />);
    const options = Array.from(screen.getByLabelText('Player').querySelectorAll('option')).map((o) => o.textContent);
    expect(options).not.toContain('Ash');
    expect(options).not.toContain('Avery');
    expect(options).toContain('Bea');
  });

  it('shows every share box with its % unit, and Remove in red words last in its row (no bare ×)', () => {
    render(<TeamAdmin data={data()} membershipId="m1" onChanged={vi.fn()} />);
    for (const label of ['Ash (%)', 'Avery (%)', 'Share (%)']) expect(screen.getByLabelText(label)).toBeTruthy();
    const remove = screen.getByRole('button', { name: 'Remove Ash from Gimp Zeal' });
    expect([remove.textContent, remove.className]).toEqual(['Remove', 'danger-link']);
    expect(remove.querySelector('svg')).toBeNull();
    expect([...remove.closest('form')!.querySelectorAll('button')].at(-1)).toBe(remove);
  });

  it('edits a percent in place and removes with Remove (no confirm: it can be added back)', async () => {
    const changed = vi.fn();
    const confirm = vi.spyOn(window, 'confirm');
    render(<TeamAdmin data={data()} membershipId="m1" onChanged={changed} />);
    fireEvent.change(screen.getByLabelText('Ash (%)'), { target: { value: '40' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    await waitFor(() => expect(api.adminSetShare).toHaveBeenCalledWith('S1', 'm1', 'a0', 40));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ash from Gimp Zeal' }));
    await waitFor(() => expect(api.adminSetShare).toHaveBeenCalledWith('S1', 'm1', 'a0', null));
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
  });

  it('never sends 0 or a bad percent, even when the form is submitted directly', () => {
    render(<TeamAdmin data={data()} membershipId="m1" onChanged={() => {}} />);
    const box = screen.getByLabelText('Ash (%)') as HTMLInputElement;
    const save = screen.getAllByRole('button', { name: 'Save' })[0] as HTMLButtonElement;
    expect(save.disabled).toBe(true); // same as the current share
    for (const v of ['', '0', '101', '2.5']) {
      fireEvent.change(box, { target: { value: v } });
      fireEvent.submit(box.form!);
    }
    fireEvent.change(screen.getByLabelText('Player'), { target: { value: 'a4' } });
    for (const v of ['', '0', '101', '2.5']) {
      fireEvent.change(screen.getByLabelText('Share (%)'), { target: { value: v } });
      fireEvent.submit(screen.getByLabelText('Share (%)').closest('form')!);
    }
    fireEvent.change(screen.getByLabelText('Share (%)'), { target: { value: '25' } });
    fireEvent.submit(screen.getByLabelText('Share (%)').closest('form')!);
    expect(api.adminSetShare).toHaveBeenCalledTimes(1);
    expect(api.adminSetShare).toHaveBeenCalledWith('S1', 'm1', 'a4', 25);
  });

  it('warns past the roster size and keeps Add enabled', () => {
    render(<TeamAdmin data={data(7)} membershipId="m1" onChanged={() => {}} />);
    expect(screen.getByText('7 of 6 players')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Player'), { target: { value: 'a7' } });
    fireEvent.change(screen.getByLabelText('Share (%)'), { target: { value: '10' } });
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains when share buying hasn't settled", () => {
    render(<TeamAdmin data={data(2, { stageSettled: false })} membershipId="m1" onChanged={() => {}} />);
    expect(screen.getByText('Close share buying first')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('renames the team, and shows the error sentence when the name is taken', async () => {
    const changed = vi.fn();
    render(<TeamAdmin data={data()} membershipId="m1" onChanged={changed} />);
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Zeal Gimp' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(api.adminRenameTeam).toHaveBeenCalledWith('m1', 'Zeal Gimp'));
    await waitFor(() => expect(changed).toHaveBeenCalled());

    vi.mocked(api.adminRenameTeam).mockRejectedValueOnce({ message: 'TEAM_NAME_TAKEN' });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Another team in this league already has that name.');
  });

  it('shows nothing for a removed team', () => {
    const { container } = render(<TeamAdmin data={data()} membershipId="m2" onChanged={() => {}} />);
    expect(container.textContent).toBe('');
  });
});
