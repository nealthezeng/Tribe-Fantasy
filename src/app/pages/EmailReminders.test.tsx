// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailReminders } from './EmailReminders';
import { api } from '../lib/rpc';

const profile = vi.hoisted(() => ({ row: null as { notify_email: boolean } | null }));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: profile.row, error: null }),
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
});
