// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { StagesPanel } from './StagesPanel';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({ stages: [] as Row[], games: [] as Row[], audit_log: [] as Row[] }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      // eq filters only apply to columns the fixture rows actually carry (e.g. games.stage_id).
      const rows = () => ((db as Record<string, Row[]>)[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === undefined || r[c] === v));
      const builder = {
        select: () => builder,
        eq: (c: string, v: unknown) => { filters.push([c, v]); return builder; },
        in: () => builder,
        order: () => builder,
        then: (resolve: (v: { data: Row[]; error: null }) => void) => resolve({ data: rows(), error: null }),
      };
      return builder;
    },
  },
}));

vi.mock('../../lib/rpc', () => ({
  api: {
    resetGame: vi.fn(), deleteStage: vi.fn(), runAuction: vi.fn(async () => ({ by_bid: 3, empty: 69 })), openAuction: vi.fn(),
    openTournament: vi.fn(), setGameCount: vi.fn(),
  },
}));

const pairings = [{ league_id: 'L', home: 'm1', away: 'm2' }];
const provisional = [{ league_id: 'L', order: ['m1', 'm2'], meetings: {}, season_meetings: {} }];
vi.mock('../../lib/tournament', async (orig) => ({
  ...(await orig<typeof import('../../lib/tournament')>()),
  seasonPairings: () => Promise.resolve({
    pairings, provisional, league: new Map([['L', 'League A']]), team: new Map([['m1', 'Zeal'], ['m2', 'Flow']]),
  }),
}));

afterEach(() => {
  cleanup();
  db.games = [];
  db.audit_log = [];
});
const stage = (id: string, starts_on: string, bid_close_at: string, ends_on = '2027-12-31') => (
  { id, name: id, starts_on, ends_on, bid_close_at, auction_run_at: bid_close_at }
);

describe('StagesPanel', () => {
  it('offers Open tournament only on the current stage', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z', '2026-09-10'), stage('Spring', '2027-02-01', '2027-02-10T00:00:00Z')];
    render(<StagesPanel seasonId="se1" />);
    const buttons = await screen.findAllByRole('button', { name: 'Open tournament' });
    expect(buttons).toHaveLength(1);
    expect(within(buttons[0].closest('li')!).getByText('Spring')).toBeTruthy();
  });

  it('undoes the newest started game, not the unstarted one its finish created (t121)', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    const game = (id: string, number: number, started_at: string | null) =>
      ({ id, stage_id: 'Fall', number, session_id: null, started_at, finished_at: null, opponent: null });
    db.games = [game('g1', 1, '2026-11-07T14:00:00Z'), game('g2', 2, '2026-11-07T16:00:00Z'), game('g3', 3, null)];
    window.confirm = () => true;
    render(<StagesPanel seasonId="se1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Undo game 2', hidden: true }));
    await waitFor(() => expect(api.resetGame).toHaveBeenCalledWith('g2'));
  });

  it('offers no Undo on a past tournament', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z', '2026-09-10'), stage('Spring', '2027-02-01', '2027-02-10T00:00:00Z')];
    db.games = [{ id: 'g1', stage_id: 'Fall', number: 1, session_id: null, started_at: '2026-11-07T14:00:00Z', finished_at: null, opponent: null }];
    render(<StagesPanel seasonId="se1" />);
    await screen.findAllByText('Fall');
    await waitFor(() => expect(document.querySelectorAll('details.section').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Undo game 1', hidden: true })).toBeNull();
  });

  it('checks each game once even when undo + replay finished it twice', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    const game = (id: string, number: number, started_at: string | null) =>
      ({ id, stage_id: 'Fall', number, session_id: null, started_at, finished_at: null, opponent: null });
    db.games = [game('g1', 1, '2026-11-07T14:00:00Z'), game('g2', 2, null)];
    const finishRow = { entity_id: 'g1', details: { pairings: [], provisional: [] } };
    db.audit_log = [finishRow, finishRow];
    render(<StagesPanel seasonId="se1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check pairings', hidden: true }));
    await screen.findByText(/Game 2: matches/, undefined, { timeout: 2000 });
    expect(screen.getAllByText(/Game 2:/)).toHaveLength(1);
  });

  it('opens share buying with a "Buying closes" field', async () => {
    db.stages = [{ id: 'Fall', name: 'Fall', starts_on: '2026-09-01', ends_on: '2026-09-10', bid_close_at: null, auction_run_at: null }];
    render(<StagesPanel seasonId="se1" />);
    await screen.findByLabelText('Buying closes');
    expect(screen.getByRole('button', { name: 'Open share buying' })).toBeTruthy();
    expect(screen.getByText('Share buying not open')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bbid|auction/i);
  });

  it('settles shares and reports buys settled and spots empty', async () => {
    db.stages = [{ id: 'Fall', name: 'Fall', starts_on: '2026-09-01', ends_on: '2026-09-10', bid_close_at: '2026-09-01T00:00:00Z', auction_run_at: null }];
    window.confirm = () => true;
    render(<StagesPanel seasonId="se1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settle shares' }));
    await screen.findByText('Fall: 3 buys settled, 69 spots empty.');
    expect(api.runAuction).toHaveBeenCalledWith('Fall');
    expect(document.body.textContent).not.toMatch(/\bbid|auction|random fill/i);
  });

  it('deletes a tournament from its Edit form after a confirm (t121)', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    window.confirm = () => true;
    render(<StagesPanel seasonId="se1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.queryByLabelText('Event')).toBeNull(); // t124: Name names the tournament
    fireEvent.click(screen.getByRole('button', { name: 'Delete tournament' }));
    await waitFor(() => expect(api.deleteStage).toHaveBeenCalledWith('Fall'));
  });

  const game = (number: number, started_at: string | null, finished_at: string | null = null) =>
    ({ id: `g${number}`, stage_id: 'Fall', number, session_id: null, started_at, finished_at, opponent: null });
  const T = '2026-11-07T14:00:00Z';

  it('opens a tournament with a required Games count', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    window.confirm = () => true;
    render(<StagesPanel seasonId="se1" />);
    const open = await screen.findByRole('button', { name: 'Open tournament' }) as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Games'), { target: { value: '4' } });
    expect(open.disabled).toBe(false);
    fireEvent.click(open);
    await waitFor(() => expect(api.openTournament).toHaveBeenCalledWith('Fall', pairings, 4));
  });

  it('words the summary by the current game and saves a lower count without a confirm', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    db.games = [game(1, T, T), game(2, null), game(3, null), game(4, null)];
    window.confirm = () => { throw new Error('no confirm expected'); };
    render(<StagesPanel seasonId="se1" />);
    await screen.findByText(/game 2 next of 4/);
    const input = screen.getByLabelText('Games', { selector: 'input' }) as HTMLInputElement;
    expect(input.min).toBe('1');
    expect(input.value).toBe('4');
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save count', hidden: true }));
    await waitFor(() => expect(api.setGameCount).toHaveBeenCalledWith('Fall', 2));
    await screen.findByText('Fall: 2 games.');
  });

  it('never lets the count drop below the highest started game', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    db.games = [game(1, T, T), game(2, T), game(3, null)];
    render(<StagesPanel seasonId="se1" />);
    await screen.findByText(/game 2 live of 3/);
    expect((screen.getByLabelText('Games', { selector: 'input' }) as HTMLInputElement).min).toBe('2');
  });

  it('shows the new game pairings before raising a finished tournament, and sends them', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    db.games = [game(1, T, T), game(2, T, T)];
    const ask = vi.fn(() => true);
    window.confirm = ask;
    render(<StagesPanel seasonId="se1" />);
    await screen.findByText(/over after game 2/);
    fireEvent.change(screen.getByLabelText('Games', { selector: 'input' }), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save count', hidden: true }));
    await waitFor(() => expect(api.setGameCount).toHaveBeenCalledWith('Fall', 3, pairings, provisional));
    expect(ask).toHaveBeenCalledWith(expect.stringContaining('Zeal'));
  });
});
