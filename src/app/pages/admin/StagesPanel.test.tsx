// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../../lib/rpc', () => ({ api: {} }));

afterEach(cleanup);

describe('StagesPanel', () => {
  it('offers Open tournament only on the current stage', async () => {
    const stage = (id: string, starts_on: string, bid_close_at: string) => (
      { id, name: id, starts_on, ends_on: '2027-12-31', tournament: null, bid_close_at, auction_run_at: bid_close_at }
    );
    db.stages = [stage('Fall', '2026-09-01', '2026-09-10T00:00:00Z'), stage('Spring', '2027-02-01', '2027-02-10T00:00:00Z')];
    render(<StagesPanel seasonId="se1" />);
    const buttons = await screen.findAllByRole('button', { name: 'Open tournament' });
    expect(buttons).toHaveLength(1);
    expect(within(buttons[0].closest('li')!).getByText('Spring')).toBeTruthy();
  });
});
