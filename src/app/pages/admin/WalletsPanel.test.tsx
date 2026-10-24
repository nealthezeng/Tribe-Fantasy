// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/rpc';
import type { LedgerEntry } from '../../lib/wallet';
import { WalletsPanel } from './WalletsPanel';

const entry = (id: number, kind: LedgerEntry['kind'], amount: number, over: Partial<LedgerEntry> = {}): LedgerEntry =>
  ({ id, kind, amount, dollars: null, note: null, created_at: `2026-11-0${id}T12:00:00Z`, stages: null, ...over });
const CCCS = { name: 'CCCs' };
const FEAST = { name: 'Feasterns' };

const DB = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, leagues: [] as unknown[] }));
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder = {
        select: () => builder, eq: () => builder, order: () => builder,
        single: () => Promise.resolve({ data: { settings: DB.settings }, error: null }),
        then: (resolve: (v: { data: unknown[]; error: null }) => void) => resolve({ data: table === 'leagues' ? DB.leagues : [], error: null }),
      };
      return builder;
    },
  },
}));
vi.mock('../../lib/rpc', () => ({ api: { adjustCredits: vi.fn(), recordDonation: vi.fn() } }));
vi.mock('./VenmoReceipts', () => ({ VenmoReceipts: () => <p>Venmo receipts</p> }));

beforeEach(() => {
  DB.settings = { donations_enabled: true, credits_per_dollar: 2 };
  DB.leagues = [
    { id: 'l1', name: 'Huck Yeah', memberships: [
      { id: 'm1', team_name: 'Gimp Zeal', removed_at: null, credit_ledger: [
        entry(1, 'allowance', 100, { stages: CCCS }), entry(2, 'bid', -40, { stages: CCCS }), entry(3, 'adjustment', 5, { note: 'Typo fix' }),
        entry(4, 'donation', 20, { dollars: '10.00' }), entry(5, 'adjustment', -2, { note: 'Double grant' }),
        entry(6, 'allowance', 50, { stages: FEAST }), entry(7, 'bid', -25, { stages: FEAST })] },
      { id: 'm2', team_name: 'Money', removed_at: '2026-11-05T00:00:00Z', credit_ledger: [entry(1, 'allowance', 40, { stages: CCCS })] }] },
    { id: 'l2', name: 'Zip Zap', memberships: [{ id: 'm3', team_name: 'Late Larks', removed_at: null, credit_ledger: [] }] },
  ];
  vi.mocked(api.adjustCredits).mockResolvedValue(1);
  vi.mocked(api.recordDonation).mockResolvedValue(1);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

/** A team's closed wallet row: its summary. */
const row = (team: string) => screen.getByText(team).closest<HTMLElement>('summary.row-link')!;
/** Opens a team's wallet row (P9 rule 1) and returns what it holds. */
const openRow = async (team: string) => {
  fireEvent.click((await screen.findByText(team)).closest('summary')!);
  const details = row(team).closest('details')!;
  expect(details.open).toBe(true);
  return within(details);
};
/** The form whose submit button reads `button`, inside an opened row. */
const formOf = (r: ReturnType<typeof within>, button: string) => within(r.getByRole('button', { name: button }).closest('form')!);

describe('WalletsPanel (P9 T18)', () => {
  it('shows one row per team: its name, its league and its balance, removed teams marked', async () => {
    render(<WalletsPanel seasonId="s1" />);
    await screen.findByText('Gimp Zeal');
    expect(within(row('Gimp Zeal')).getByText('Huck Yeah')).toBeTruthy();
    expect(within(row('Gimp Zeal')).getByText('108 credits')).toBeTruthy();
    expect(within(row('Money (removed)')).getByText('40 credits')).toBeTruthy();
    expect(within(row('Late Larks')).getByText('Zip Zap')).toBeTruthy();
    expect(within(row('Late Larks')).getByText('0 credits')).toBeTruthy();
    expect(document.querySelector('.pill')).toBeNull(); // a team with no credits gets nothing extra (ruling 76)
    expect(screen.getByText('Venmo receipts')).toBeTruthy();
  });

  it('lists teams by name within each league', async () => {
    DB.leagues = [{ ...(DB.leagues[0] as object), memberships: [...(DB.leagues[0] as { memberships: unknown[] }).memberships].reverse() }, DB.leagues[1]];
    render(<WalletsPanel seasonId="s1" />);
    await screen.findByText('Gimp Zeal');
    expect([...document.querySelectorAll('summary.row-link b')].map((b) => b.textContent)).toEqual(['Gimp Zeal', 'Money (removed)', 'Late Larks']);
  });

  it('names each form control after its team, visible words unchanged', async () => {
    render(<WalletsPanel seasonId="s1" />);
    const zeal = await openRow('Gimp Zeal');
    expect(zeal.getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-label')]))
      .toEqual([['Save', 'Save for Gimp Zeal'], ['Record donation', 'Record donation for Gimp Zeal']]);
    expect(zeal.getAllByRole('textbox').concat(zeal.getAllByRole('spinbutton')).map((i) => i.getAttribute('aria-label')).sort()).toEqual([
      'Credits (+/−) for Gimp Zeal', 'Dollars donated to the team for Gimp Zeal', "Note on Gimp Zeal's adjustment", "Note on Gimp Zeal's donation"]);
  });

  it('opens to the last 5 credit lines, newest first', async () => {
    render(<WalletsPanel seasonId="s1" />);
    const zeal = await openRow('Gimp Zeal');
    const lines = zeal.getAllByRole('listitem').map((li) => li.textContent);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^Shares — Feasterns.*-25$/);
    expect(lines[1]).toMatch(/^Allowance — Feasterns.*\+50$/);
    expect(lines[2]).toMatch(/^Adjustment — Double grant.*-2$/);
    expect(lines[3]).toMatch(/^Donation to the team — \$10\.00.*\+20$/);
    expect(lines[4]).toMatch(/^Adjustment — Typo fix.*\+5$/);
    expect(zeal.queryByText(/CCCs/)).toBeNull();
    expect((await openRow('Late Larks')).getByText('No credits yet.')).toBeTruthy();
  });

  it("adjusts that team's credits and says so right under its own Save", async () => {
    render(<WalletsPanel seasonId="s1" />);
    const zeal = await openRow('Gimp Zeal');
    const adjust = formOf(zeal, 'Save for Gimp Zeal');
    fireEvent.change(adjust.getByLabelText('Credits (+/−) for Gimp Zeal'), { target: { value: '-5' } });
    fireEvent.change(adjust.getByLabelText("Note on Gimp Zeal's adjustment"), { target: { value: 'Paid twice' } });
    fireEvent.click(adjust.getByRole('button', { name: 'Save for Gimp Zeal' }));
    await waitFor(() => expect(api.adjustCredits).toHaveBeenCalledWith('m1', -5, 'Paid twice'));
    const done = await zeal.findByText('Adjusted Gimp Zeal by -5.');
    expect(done.previousElementSibling).toBe(zeal.getByRole('button', { name: 'Save for Gimp Zeal' }).closest('form'));
    expect((adjust.getByLabelText('Credits (+/−) for Gimp Zeal') as HTMLInputElement).value).toBe('');
  });

  it("says why an adjustment failed in that team's row, and keeps what was typed", async () => {
    vi.mocked(api.adjustCredits).mockRejectedValueOnce({ message: 'FORBIDDEN' });
    render(<WalletsPanel seasonId="s1" />);
    const zeal = await openRow('Gimp Zeal');
    const adjust = formOf(zeal, 'Save for Gimp Zeal');
    fireEvent.change(adjust.getByLabelText('Credits (+/−) for Gimp Zeal'), { target: { value: '7' } });
    fireEvent.click(adjust.getByRole('button', { name: 'Save for Gimp Zeal' }));
    expect((await zeal.findByRole('alert')).textContent).toBe("You don't have permission to do that.");
    expect((adjust.getByLabelText('Credits (+/−) for Gimp Zeal') as HTMLInputElement).value).toBe('7');
  });

  it('records a donation to the team from the opened row while donations are on', async () => {
    render(<WalletsPanel seasonId="s1" />);
    const zeal = await openRow('Gimp Zeal');
    expect(zeal.getByText('Only once the treasurer has the money. 2 credits per dollar.')).toBeTruthy();
    const donate = formOf(zeal, 'Record donation for Gimp Zeal');
    fireEvent.change(donate.getByLabelText('Dollars donated to the team for Gimp Zeal'), { target: { value: '10' } });
    fireEvent.change(donate.getByLabelText("Note on Gimp Zeal's donation"), { target: { value: 'Venmo 1234' } });
    fireEvent.click(donate.getByRole('button', { name: 'Record donation for Gimp Zeal' }));
    await waitFor(() => expect(api.recordDonation).toHaveBeenCalledWith('m1', 10, 'Venmo 1234'));
    expect(await zeal.findByText('Recorded a $10.00 donation to the team from Gimp Zeal.')).toBeTruthy();
    // One gold button per opened row (P9 rule 2): Save; Record donation is secondary.
    expect(zeal.getByRole('button', { name: 'Record donation for Gimp Zeal' }).className).toBe('secondary');
    expect(zeal.getByRole('button', { name: 'Save for Gimp Zeal' }).className).toBe('');
  });

  it('has no donation form while donations are off', async () => {
    DB.settings = {};
    render(<WalletsPanel seasonId="s1" />);
    const zeal = await openRow('Gimp Zeal');
    expect(zeal.getByRole('button', { name: 'Save for Gimp Zeal' })).toBeTruthy();
    expect(zeal.queryByRole('button', { name: 'Record donation for Gimp Zeal' })).toBeNull();
  });

  it('says so when the season has no teams', async () => {
    DB.leagues = [{ id: 'l1', name: 'Huck Yeah', memberships: [] }];
    render(<WalletsPanel seasonId="s1" />);
    expect(await screen.findByText('No teams in this season yet.')).toBeTruthy();
  });
});
