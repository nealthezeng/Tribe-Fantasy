// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  anon: false, rows: null as { name: string | null; dollars: number; is_me: boolean }[] | null,
  boardFails: false, prefFails: false, saveFails: false,
}));
vi.mock('../lib/rpc', () => ({
  api: {
    donationLeaderboard: vi.fn(async () => {
      if (state.boardFails) throw new Error('board down');
      return state.rows ?? [
        { name: 'Sam', dollars: 20, is_me: false },
        { name: state.anon ? null : 'Me', dollars: 7.5, is_me: true },
      ];
    }),
    myDonateAnonymously: vi.fn(async () => { if (state.prefFails) throw new Error('pref down'); return state.anon; }),
    setDonateAnonymously: vi.fn(async (on: boolean) => {
      if (state.saveFails) throw new Error('save failed');
      state.anon = on;
    }),
  },
}));
import { Donors } from './Credits';

afterEach(() => {
  cleanup();
  Object.assign(state, { anon: false, rows: null, boardFails: false, prefFails: false, saveFails: false });
});
const show = () => render(<Donors uid="u" seasonId="s" />);
const box = () => screen.getByRole('checkbox', { name: /Anonymous/ }) as HTMLInputElement;

describe('Donors', () => {
  it('lists donors by name and total; the tick box flips at once and shows you as Anonymous', async () => {
    show();
    expect(await screen.findByText(/1\. Sam/)).toBeTruthy();
    expect(screen.getByText('$7.50')).toBeTruthy();
    await waitFor(() => expect(box().disabled).toBe(false));
    fireEvent.click(box());
    expect(box().checked).toBe(true); // before the save lands
    expect(await screen.findByText(/2\. Anonymous/)).toBeTruthy();
    expect(box().checked).toBe(true);
  });

  it('says so when nobody has donated', async () => {
    state.rows = [];
    show();
    expect(await screen.findByText('No donations yet.')).toBeTruthy();
  });

  it('rolls the box back and says why when the save fails', async () => {
    state.saveFails = true;
    show();
    await waitFor(() => expect(box().disabled).toBe(false));
    fireEvent.click(box());
    expect((await screen.findByRole('alert')).textContent).toContain('save failed');
    expect(box().checked).toBe(false);
  });

  it('shows a failed load with Try again, for the list and for your choice', async () => {
    state.boardFails = true;
    state.prefFails = true;
    show();
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
    expect(box().disabled).toBe(true);
    state.boardFails = false;
    state.prefFails = false;
    for (const b of screen.getAllByRole('button', { name: 'Try again' })) fireEvent.click(b);
    expect(await screen.findByText(/1\. Sam/)).toBeTruthy();
    await waitFor(() => expect(box().disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
