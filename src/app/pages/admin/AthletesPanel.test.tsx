// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { AthletesPanel } from './AthletesPanel';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === 'athletes' ? [{ id: 'a1', name: 'Sam', opted_in: true, user_id: null }] : [];
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
  },
}));

vi.mock('../../lib/rpc', () => ({ api: { deleteAthlete: vi.fn() } }));

const confirm = vi.fn();
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(api.deleteAthlete).mockReset();
  confirm.mockReset();
  window.confirm = confirm;
});

async function clickRemove() {
  render(<AthletesPanel seasonId="se1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
}

describe('AthletesPanel remove (t81)', () => {
  it('deletes an unused athlete with one confirm and no force', async () => {
    confirm.mockReturnValue(true);
    vi.mocked(api.deleteAthlete).mockResolvedValue(undefined);
    await clickRemove();
    await waitFor(() => expect(api.deleteAthlete).toHaveBeenCalledTimes(1));
    expect(api.deleteAthlete).toHaveBeenCalledWith('a1');
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('asks again when the athlete has history, and forces only on a second yes', async () => {
    confirm.mockReturnValue(true);
    vi.mocked(api.deleteAthlete).mockRejectedValueOnce({ message: 'ATHLETE_IN_USE' }).mockResolvedValueOnce(undefined);
    await clickRemove();
    await waitFor(() => expect(api.deleteAthlete).toHaveBeenCalledWith('a1', true));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][0]).toMatch(/change past results and standings/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does nothing more when the second confirm is declined', async () => {
    confirm.mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.mocked(api.deleteAthlete).mockRejectedValueOnce({ message: 'ATHLETE_IN_USE' });
    await clickRemove();
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
    expect(api.deleteAthlete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows other errors without a second confirm', async () => {
    confirm.mockReturnValue(true);
    vi.mocked(api.deleteAthlete).mockRejectedValueOnce({ message: 'FORBIDDEN' });
    await clickRemove();
    expect((await screen.findByRole('alert')).textContent).toContain("You don't have permission");
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
