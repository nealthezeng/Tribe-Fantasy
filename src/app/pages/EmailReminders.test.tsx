// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailReminders } from './EmailReminders';
import { api } from '../lib/rpc';

const profile = vi.hoisted(() => ({ row: null as { notify_email: boolean } | null, fail: false }));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve(profile.fail ? { data: null, error: new Error('offline') } : { data: profile.row, error: null }),
      };
      return builder;
    },
  },
}));

vi.mock('../lib/rpc', () => ({
  api: { setNotifyEmail: vi.fn(async (on: boolean) => { profile.row = { notify_email: on }; }) },
}));

afterEach(cleanup);

const box = () => screen.getByRole('checkbox', { name: /email me before bidding closes/i }) as HTMLInputElement;

describe('EmailReminders', () => {
  it('shows emails on by default and turns them off', async () => {
    profile.row = { notify_email: true };
    render(<EmailReminders uid="u1" />);
    await waitFor(() => expect(box().disabled).toBe(false));
    expect(box().checked).toBe(true);
    fireEvent.click(box());
    await waitFor(() => expect(api.setNotifyEmail).toHaveBeenCalledWith(false));
    await waitFor(() => expect(box().checked).toBe(false));
  });

  it('shows the saved choice when a user turned emails off', async () => {
    profile.row = { notify_email: false };
    render(<EmailReminders uid="u1" />);
    await waitFor(() => expect(box().disabled).toBe(false));
    expect(box().checked).toBe(false);
  });

  it('flips at once, and rolls back with the error when the save fails', async () => {
    profile.row = { notify_email: true };
    let reject!: (e: Error) => void;
    vi.mocked(api.setNotifyEmail).mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    render(<EmailReminders uid="u1" />);
    await waitFor(() => expect(box().disabled).toBe(false));
    fireEvent.click(box());
    expect(box().checked).toBe(false); // before the save lands
    reject(new Error('offline'));
    await screen.findByRole('alert');
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(false);
  });

  it('offers a retry when the first load fails', async () => {
    profile.row = { notify_email: false };
    profile.fail = true;
    render(<EmailReminders uid="u1" />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(box().disabled).toBe(true);
    profile.fail = false;
    fireEvent.click(retry);
    await waitFor(() => expect(box().disabled).toBe(false));
    expect(box().checked).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
