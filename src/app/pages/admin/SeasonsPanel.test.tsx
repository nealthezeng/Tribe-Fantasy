// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { SeasonsPanel } from './SeasonsPanel';

const ALL = [{ id: 's2', name: 'Spring 2027', status: 'setup' }, { id: 's1', name: 'Fall 2026', status: 'live' }];
const db = vi.hoisted(() => ({ seasons: [] as { id: string; name: string; status: string }[] }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => {
      const builder = {
        select: () => builder,
        order: () => builder,
        // A little latency, like the real network: the old list is still on screen while a reload is in flight.
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
          const rows = [...db.seasons];
          setTimeout(() => resolve({ data: rows, error: null }), 20);
        },
      };
      return builder;
    },
  },
}));

vi.mock('../../lib/rpc', () => ({ api: {
  deleteSeason: vi.fn((id: string) => { db.seasons = db.seasons.filter((s) => s.id !== id); return Promise.resolve(); }),
  renameSeason: vi.fn(() => Promise.resolve()),
} }));

beforeEach(() => { db.seasons = [...ALL]; });
afterEach(cleanup);

/** Holds the selection like AdminPage does. */
function Host() {
  const [selected, setSelected] = useState<string | null>(null);
  return <><SeasonsPanel selected={selected} onSelect={setSelected} /><output data-testid="selected">{selected ?? 'none'}</output></>;
}

describe('SeasonsPanel (t213)', () => {
  it('unlocks Delete season only once the name is typed, and warns that the next season becomes current', async () => {
    const onSelect = vi.fn();
    render(<SeasonsPanel selected="s2" onSelect={onSelect} />);
    const del = await screen.findByRole('button', { name: 'Delete season', hidden: true });
    expect(screen.getByText(/Everyone will see Fall 2026 as the current season/)).toBeTruthy();
    const confirm = screen.getByLabelText('Type Spring 2027 to confirm');
    fireEvent.change(confirm, { target: { value: 'spring 2027' } });
    expect((del as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(confirm, { target: { value: 'Spring 2027' } });
    expect((del as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(del);
    await waitFor(() => expect(api.deleteSeason).toHaveBeenCalledWith('s2'));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('moves to the next newest season after deleting the newest, never back to the deleted one', async () => {
    render(<Host />);
    const confirm = await screen.findByLabelText('Type Spring 2027 to confirm');
    fireEvent.change(confirm, { target: { value: 'Spring 2027' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete season', hidden: true }));
    await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('s1'));
    expect(screen.queryByText('Spring 2027')).toBeNull();
    expect(screen.getByText('Managing')).toBeTruthy();
  });

  it('renames the managed season, with no current-season warning on an older one', async () => {
    render(<SeasonsPanel selected="s1" onSelect={vi.fn()} />);
    const input = await screen.findByDisplayValue('Fall 2026');
    expect(screen.queryByText(/as the current season/)).toBeNull();
    fireEvent.change(input, { target: { value: 'Fall Beta 2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename season', hidden: true }));
    await waitFor(() => expect(api.renameSeason).toHaveBeenCalledWith('s1', 'Fall Beta 2026'));
  });
});
