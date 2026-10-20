// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryPanel } from './HistoryPanel';

const DB = vi.hoisted(() => ({
  audit: [] as Record<string, unknown>[], ranges: [] as [number, number][], eqs: [] as [string, string][],
  hold: false, pending: [] as (() => void)[],
}));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      let action = '';
      let from = 0;
      let to = 49;
      const builder = {
        select: () => builder, in: () => builder, order: () => builder,
        eq: (c: string, v: string) => { if (table === 'audit_log') { DB.eqs.push([c, v]); action = v; } return builder; },
        range: (a: number, b: number) => { DB.ranges.push([a, b]); from = a; to = b; return builder; },
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
          const data: Record<string, unknown[]> = {
            audit_log: DB.audit.filter((r) => !action || r.action === action).slice(from, to + 1),
            profiles: [{ id: 'u9', display_name: 'Ava Admin' }], memberships: [{ id: 'm1', team_name: 'Gimp Zeal' }],
            athletes: [{ id: 'a1', name: 'Sam Grossberg' }],
          };
          const done = () => resolve({ data: data[table] ?? [], error: null });
          // A held Load more stays in flight until the test releases it.
          if (DB.hold && table === 'audit_log' && from >= 50) DB.pending.push(done); else done();
        },
      };
      return builder;
    },
  },
}));

const mk = (id: number, actor: string | null, action: string, details: Record<string, unknown> = {}) =>
  ({ id, at: `2026-10-19T12:${String(59 - (id % 60)).padStart(2, '0')}:00Z`, actor, action, entity: 'membership', entity_id: 'm1', details });
afterEach(() => { cleanup(); DB.ranges = []; DB.eqs = []; DB.hold = false; DB.pending = []; });

describe('HistoryPanel', () => {
  it('lists newest first with the actor name, and Removed user for an unknown actor', async () => {
    DB.audit = [
      mk(2, 'u9', 'admin_set_share', { membership: 'm1', athlete: 'a1', old_percent: 0, new_percent: 25 }),
      mk(1, 'gone', 'delete_stage'),
    ];
    render(<HistoryPanel />);
    const items = await screen.findAllByRole('listitem');
    expect(within(items[0]).getByText('Gave Sam Grossberg 25% to Gimp Zeal')).toBeTruthy();
    expect(within(items[0]).getByText('Ava Admin')).toBeTruthy();
    expect(within(items[1]).getByText('Delete stage')).toBeTruthy();
    expect(within(items[1]).getByText('Removed user')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('shows Automatic for a null actor (a system write), not Removed user', async () => {
    DB.audit = [mk(1, null, 'record_donation')];
    render(<HistoryPanel />);
    const item = (await screen.findAllByRole('listitem'))[0];
    expect(within(item).getByText('Automatic')).toBeTruthy();
    expect(within(item).queryByText('Removed user')).toBeNull();
  });

  it('loads the next 50 on Load more', async () => {
    DB.audit = Array.from({ length: 60 }, (_, i) => mk(60 - i, 'u9', 'delete_stage'));
    render(<HistoryPanel />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(50));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(60));
    expect(DB.ranges).toContainEqual([50, 99]);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('re-queries with the chosen action', async () => {
    DB.audit = [mk(1, 'u9', 'delete_stage')];
    render(<HistoryPanel />);
    await screen.findByText('Delete stage');
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'admin_remove_user' } });
    await waitFor(() => expect(DB.eqs).toContainEqual(['action', 'admin_remove_user']));
    expect(DB.ranges.at(-1)).toEqual([0, 49]);
  });

  it('disables Load more while a page is loading, and ignores a double click', async () => {
    DB.audit = Array.from({ length: 120 }, (_, i) => mk(120 - i, 'u9', 'delete_stage'));
    render(<HistoryPanel />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(50));
    DB.hold = true;
    const button = screen.getByRole('button', { name: 'Load more' }) as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(button.disabled).toBe(true));
    fireEvent.click(button);
    expect(DB.ranges.filter(([a]) => a === 50)).toHaveLength(1);
    DB.hold = false;
    DB.pending.splice(0).forEach((f) => f());
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(100));
    expect((screen.getByRole('button', { name: 'Load more' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('drops a Load more page that comes back after the filter changed', async () => {
    DB.audit = [
      ...Array.from({ length: 60 }, (_, i) => mk(100 - i, 'u9', 'delete_stage')),
      mk(5, 'u9', 'admin_rename_team', { old: 'Old', new: 'New' }),
    ];
    render(<HistoryPanel />);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(50));
    DB.hold = true;
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(DB.pending).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'admin_rename_team' } });
    await screen.findByText('Renamed team Old → New');
    DB.pending.splice(0).forEach((f) => f());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('Delete stage', { selector: 'li span' })).toBeNull();
  });

  it('never says bid or auction in the filter or a fallback row', async () => {
    DB.audit = [mk(2, 'u9', 'delete_bid'), mk(1, 'u9', 'run_auction')];
    render(<HistoryPanel />);
    await screen.findByText('Delete share buy');
    expect(screen.getByText('Settle shares', { selector: 'li span' })).toBeTruthy();
    const options = within(screen.getByLabelText('Action')).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(options).toContain('Open share buying');
    expect(options).toContain('Remove account');
    expect([...options, document.querySelector('ul')!.textContent ?? ''].filter((t) => /bid|auction/i.test(t))).toEqual([]);
  });
});
