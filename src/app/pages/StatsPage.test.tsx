// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatsPage } from './StatsPage';

const auth = vi.hoisted(() => ({ isKeeper: true }));
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ isAdmin: false, isKeeper: auth.isKeeper }) }));
vi.mock('../lib/stats', async (orig) => ({
  ...(await orig<typeof import('../lib/stats')>()),
  loadCurrentSeason: () => Promise.resolve({ id: 'se', name: 'Spring', settings: {} }),
  gameTitles: () => Promise.resolve(new Map()),
}));
vi.mock('../lib/supabase', () => {
  const q = { select: () => q, eq: () => q, order: () => Promise.resolve({ data: [], error: null }) };
  return { supabase: { from: () => q } };
});

afterEach(cleanup);
const show = () => render(<HashRouter><StatsPage /></HashRouter>);

describe('StatsPage Tally link (t308)', () => {
  it('gives keepers a Tally link', async () => {
    auth.isKeeper = true;
    show();
    expect((await screen.findByRole('link', { name: 'Tally' })).getAttribute('href')).toBe('#/tally');
  });

  it('gives a manager none', async () => {
    auth.isKeeper = false;
    show();
    await screen.findByRole('heading', { name: /Stats/ });
    expect(screen.queryByRole('link', { name: 'Tally' })).toBeNull();
  });
});
