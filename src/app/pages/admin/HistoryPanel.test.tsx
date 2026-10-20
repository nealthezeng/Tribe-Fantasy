// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './HistoryPanel';

const DB = vi.hoisted(() => ({
  audit: [] as Record<string, unknown>[], ranges: [] as [number, number][], eqs: [] as [string, string][],
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder = {
        select: () => builder, in: () => builder, order: () => builder,
        eq: (c: string, v: string) => { if (table === 'audit_log') DB.eqs.push([c, v]); return builder; },
        range: (a: number, b: number) => { DB.ranges.push([a, b]); return builder; },
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
          const data: Record<string, unknown[]> = {
            audit_log: DB.audit.slice(DB.ranges.at(-1)?.[0] ?? 0, (DB.ranges.at(-1)?.[1] ?? 49) + 1),
            profiles: [{ id: 'u9', display_name: 'Ava Admin' }], memberships: [{ id: 'm1', team_name: 'Gimp Zeal' }],
            athletes: [{ id: 'a1', name: 'Sam Grossberg' }],
          };
          resolve({ data: data[table] ?? [], error: null });
        },
      };
      return builder;
    },
  },
}));

const mk = (id: number, actor: string | null, action: string, details: Record<string, unknown> = {}) =>
  ({ id, at: `2026-10-19T12:${String(59 - (id % 60)).padStart(2, '0')}:00Z`, actor, action, entity: 'membership', entity_id: 'm1', details });
afterEach(() => { cleanup(); DB.ranges = []; DB.eqs = []; });

describe('HistoryPanel', () => {
  it('lists newest first with the actor name, and Removed user for an unknown actor', async () => {
    DB.audit = [
      mk(2, 'u9', 'admin_set_share', { membership: 'm1', athlete: 'a1', old_percent: 0, new_percent: 25 }),
      mk(1, 'gone', 'delete_stage'),
    ];
    render(<HistoryPanel seasonId="S1" />);
    const items = await screen.findAllByRole('listitem');
    expect(within(items[0]).getByText('Gave Sam Grossberg 25% to Gimp Zeal')).toBeTruthy();
    expect(within(items[0]).getByText('Ava Admin')).toBeTruthy();
    expect(within(items[1]).getByText('Delete stage')).toBeTruthy();
    expect(within(items[1]).getByText('Removed user')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('loads the next 50 on Load more', async () => {
    DB.audit = Array.from({ length: 60 }, (_, i) => mk(60 - i, 'u9', 'delete_stage'));
    render(<HistoryPanel seasonId="S1" />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(50));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(60));
    expect(DB.ranges).toContainEqual([50, 99]);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('re-queries with the chosen action', async () => {
    DB.audit = [mk(1, 'u9', 'delete_stage')];
    render(<HistoryPanel seasonId="S1" />);
    await screen.findByText('Delete stage');
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'admin_remove_user' } });
    await waitFor(() => expect(DB.eqs).toContainEqual(['action', 'admin_remove_user']));
    expect(DB.ranges.at(-1)).toEqual([0, 49]);
  });
});
