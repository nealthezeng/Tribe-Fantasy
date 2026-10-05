// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { StagesPanel } from './StagesPanel';

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({ stages: [] as Row[], games: [] as Row[] }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = () => (db as Record<string, Row[]>)[table] ?? [];
      const builder = {
        select: () => builder,
        eq: () => builder,
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

  it('deletes a tournament from its Edit form after a confirm (t121)', async () => {
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z')];
    window.confirm = () => true;
    render(<StagesPanel seasonId="se1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete tournament' }));
    await waitFor(() => expect(api.deleteStage).toHaveBeenCalledWith('Fall'));
  });
});
