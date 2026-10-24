// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import { AthletesPanel } from './AthletesPanel';

const ATHLETES = [
  { id: 'a1', name: 'Sam', opted_in: true, user_id: null },
  { id: 'a2', name: 'Riley Fox', opted_in: false, user_id: 'p1' },
];
const PROFILES = [{ id: 'p1', display_name: 'Riley Fox' }, { id: 'p2', display_name: 'Sam Ortiz' }];

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rows = table === 'athletes' ? ATHLETES : PROFILES;
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

vi.mock('../../lib/rpc', () => ({ api: {
  deleteAthlete: vi.fn(),
  addAthlete: vi.fn(() => Promise.resolve('a3')),
  renameAthlete: vi.fn(() => Promise.resolve()),
  setAthleteOptIn: vi.fn(() => Promise.resolve()),
  linkAthleteUser: vi.fn(() => Promise.resolve()),
} }));

const confirm = vi.fn();
afterEach(() => { cleanup(); vi.clearAllMocks(); });
beforeEach(() => {
  vi.mocked(api.deleteAthlete).mockReset();
  confirm.mockReset();
  window.confirm = confirm;
});

/** A player's row: the summary that opens their actions. */
const row = async (name: string) => (await screen.findByText(name, { selector: 'b' })).closest('summary') as HTMLElement;
/** Opens a player's row; their actions, inside the row's details. */
const open = async (name: string) => {
  const summary = await row(name);
  fireEvent.click(summary);
  const details = summary.closest('details')!;
  expect(details.open).toBe(true);
  return within(details);
};

async function clickRemove() {
  render(<AthletesPanel seasonId="se1" />);
  fireEvent.click((await open('Sam')).getByRole('button', { name: 'Remove player Sam' }));
}

describe('AthletesPanel rows (M15 P9 T17)', () => {
  it('is one row per player: the name, and "Opted out" when so', async () => {
    render(<AthletesPanel seasonId="se1" />);
    const sam = await row('Sam');
    expect(sam.className).toBe('row-link');
    expect(within(sam).queryByText('Opted out')).toBeNull();
    expect(within(await row('Riley Fox')).getByText('Opted out')).toBeTruthy();
    expect(sam.querySelectorAll('button, select')).toHaveLength(0); // the row is the button: nothing small beside it
  });

  it('opens to the linked account, Opt out, the name with Save name, and Remove last and red', async () => {
    render(<AthletesPanel seasonId="se1" />);
    const sam = await open('Sam');
    const account = sam.getByLabelText('Linked account') as HTMLSelectElement;
    expect(account.value).toBe('');
    expect([...account.options].map((o) => o.textContent)).toEqual(['No linked account', 'Riley Fox', 'Sam Ortiz']);
    expect((sam.getByLabelText('Name') as HTMLInputElement).value).toBe('Sam');
    const controls = [...account.closest('details')!.querySelectorAll('select, input, button')];
    expect(controls.map((c) => c.getAttribute('aria-label') ?? (c.tagName === 'BUTTON' ? c.textContent : c.tagName)))
      .toEqual(['SELECT', 'Opt out', 'INPUT', 'Save name', 'Remove player Sam']); // Remove names its player (ruling 73)
    const remove = sam.getByRole('button', { name: 'Remove player Sam' });
    expect(remove.textContent).toBe('Remove');
    expect(remove.className).toBe('danger-link');
    expect(((await open('Riley Fox')).getByLabelText('Linked account') as HTMLSelectElement).value).toBe('p1');
  });

  it('links and unlinks an account, opts out and back in, and saves a name', async () => {
    render(<AthletesPanel seasonId="se1" />);
    const sam = await open('Sam');
    fireEvent.change(sam.getByLabelText('Linked account'), { target: { value: 'p2' } });
    await waitFor(() => expect(api.linkAthleteUser).toHaveBeenCalledWith('a1', 'p2'));
    fireEvent.click(sam.getByRole('button', { name: 'Opt out' }));
    await waitFor(() => expect(api.setAthleteOptIn).toHaveBeenCalledWith('a1', false));
    fireEvent.change(sam.getByLabelText('Name'), { target: { value: 'Sam Ortiz' } });
    fireEvent.click(sam.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(api.renameAthlete).toHaveBeenCalledWith('a1', 'Sam Ortiz'));
    const riley = await open('Riley Fox');
    fireEvent.change(riley.getByLabelText('Linked account'), { target: { value: '' } });
    await waitFor(() => expect(api.linkAthleteUser).toHaveBeenCalledWith('a2', null));
    fireEvent.click(riley.getByRole('button', { name: 'Opt back in' }));
    await waitFor(() => expect(api.setAthleteOptIn).toHaveBeenCalledWith('a2', true));
  });

  it('adds a player', async () => {
    render(<AthletesPanel seasonId="se1" />);
    fireEvent.change(await screen.findByLabelText('Add player'), { target: { value: 'Jules Hart' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(api.addAthlete).toHaveBeenCalledWith('se1', 'Jules Hart'));
  });
});

describe('AthletesPanel remove (t81)', () => {
  it('deletes an unused athlete with one confirm and no force', async () => {
    confirm.mockReturnValue(true);
    vi.mocked(api.deleteAthlete).mockResolvedValue(undefined);
    await clickRemove();
    await waitFor(() => expect(api.deleteAthlete).toHaveBeenCalledTimes(1));
    expect(api.deleteAthlete).toHaveBeenCalledWith('a1');
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("Remove Sam? This can't be undone.");
  });

  it('asks again when the athlete has history, and forces only on a second yes', async () => {
    confirm.mockReturnValue(true);
    vi.mocked(api.deleteAthlete).mockRejectedValueOnce({ message: 'ATHLETE_IN_USE' }).mockResolvedValueOnce(undefined);
    await clickRemove();
    await waitFor(() => expect(api.deleteAthlete).toHaveBeenCalledWith('a1', true));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[1][0]).toBe('Sam has stats, shares, roster spots or picks. Deleting removes all of it, refunds '
      + 'share-buying credits, and can change past results and standings. Delete anyway?');
    expect(confirm.mock.calls[1][0]).not.toMatch(/bid|auction/i);
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

  it('shows other errors without a second confirm, in the opened row', async () => {
    confirm.mockReturnValue(true);
    vi.mocked(api.deleteAthlete).mockRejectedValueOnce({ message: 'FORBIDDEN' });
    await clickRemove();
    const details = screen.getByText('Sam', { selector: 'b' }).closest('details')!;
    expect((await within(details).findByRole('alert')).textContent).toContain("You don't have permission");
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
