// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings } from '../../core/settings';
import { api } from '../lib/rpc';
import { OutList } from './OutList';

vi.mock('../lib/rpc', () => ({ api: { setOut: vi.fn(), clearOut: vi.fn() } }));
const db = vi.hoisted(() => ({ stages: [] as unknown[], outs: [] as unknown[] }));
const stage = (id: string, name: string, starts_on: string, ends_on: string) =>
  ({ id, name, starts_on, ends_on, bid_close_at: null, auction_seed: null, auction_run_at: null });
const athletes = [
  { id: 'a1', name: 'A1', opted_in: true }, { id: 'a2', name: 'A2', opted_in: true }, { id: 'a3', name: 'A3', opted_in: false },
];
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === 'stages' ? db.stages : table === 'outs' ? db.outs : athletes;
      const builder = { select: () => builder, eq: () => builder, is: () => builder, order: () => builder,
        then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }) };
      return builder;
    },
  },
}));

const season = { id: 'se', name: 'Fall', settings: parseSettings({}) };
const past = stage('s0', 'Past', '2000-01-01', '2000-01-02');
const next = stage('s1', 'Next', '2099-01-01', '2099-01-02');

beforeEach(() => {
  vi.mocked(api.setOut).mockReset().mockResolvedValue(1);
  vi.mocked(api.clearOut).mockReset().mockResolvedValue(undefined);
  db.stages = [past, next];
  db.outs = [];
});
afterEach(cleanup);

describe('OutList', () => {
  it('lists who is out for the upcoming tournament and clears one', async () => {
    db.outs = [{ athlete_id: 'a1', from_game: 1 }];
    render(<OutList season={season} />);
    expect(await screen.findByRole('heading', { name: 'Out · Next' })).toBeTruthy();
    expect(screen.getByText('A1 · from game 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Clear A1's Out" }));
    await waitFor(() => expect(api.clearOut).toHaveBeenCalledWith('s1', 'a1'));
  });

  it('marks a player out from the picker, offering only opted-in players who are not out', async () => {
    db.outs = [{ athlete_id: 'a1', from_game: 1 }];
    render(<OutList season={season} />);
    const select = (await screen.findByRole('combobox', { name: 'Player' })) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Choose a player', 'A2']);
    fireEvent.change(select, { target: { value: 'a2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark out' }));
    await waitFor(() => expect(api.setOut).toHaveBeenCalledWith('s1', 'a2'));
  });

  it('says nobody is out, and renders nothing without an upcoming stage', async () => {
    render(<OutList season={season} />);
    expect(await screen.findByText('Nobody is out.')).toBeTruthy();
    cleanup();
    db.stages = [past];
    const none = render(<OutList season={season} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(none.container.innerHTML).toBe('');
  });
});
