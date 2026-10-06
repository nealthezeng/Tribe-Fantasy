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

vi.mock('../../lib/rpc', () => ({ api: { resetGame: vi.fn(), deleteStage: vi.fn() } }));

afterEach(() => {
  cleanup();
  db.games = [];
  db.audit_log = [];
});
const stage = (id: string, starts_on: string, bid_close_at: string) => (
  { id, name: id, starts_on, ends_on: '2027-12-31', tournament: null, bid_close_at, auction_run_at: bid_close_at }
);

describe('StagesPanel', () => {
  it('offers Open tournament only on the current stage', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z'), stage('Spring', '2027-02-01', '2027-02-10T00:00:00Z')];
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
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z'), stage('Spring', '2027-02-01', '2027-02-10T00:00:00Z')];
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

  it('deletes a tournament from its Edit form after a confirm (t121)', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    window.confirm = () => true;
    render(<StagesPanel seasonId="se1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.queryByLabelText('Event')).toBeNull(); // t124: Name names the tournament
    fireEvent.click(screen.getByRole('button', { name: 'Delete tournament' }));
    await waitFor(() => expect(api.deleteStage).toHaveBeenCalledWith('Fall'));
  });
});
