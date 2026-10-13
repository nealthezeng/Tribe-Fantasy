// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ anon: false }));
vi.mock('../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { donate_anonymously: state.anon }, error: null }) }) }) }) },
}));
vi.mock('../lib/rpc', () => ({
  api: {
    donationLeaderboard: vi.fn(async () => [
      { name: 'Sam', dollars: 20, is_me: false },
      { name: state.anon ? null : 'Me', dollars: 7.5, is_me: true },
    ]),
    setDonateAnonymously: vi.fn(async (on: boolean) => { state.anon = on; }),
  },
}));
import { Donors } from './Credits';

afterEach(() => { cleanup(); state.anon = false; });

describe('Donors', () => {
  it('lists donors by name and total, and the tick box shows you as Anonymous', async () => {
    render(<Donors uid="u" seasonId="s" />);
    expect(await screen.findByText(/1\. Sam/)).toBeTruthy();
    expect(screen.getByText('$7.50')).toBeTruthy();
    const box = screen.getByRole('checkbox', { name: /Anonymous/ }) as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    fireEvent.click(box);
    expect(await screen.findByText(/2\. Anonymous/)).toBeTruthy();
    await waitFor(() => expect(box.checked).toBe(true));
  });
});
