// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

const auth = vi.hoisted(() => ({ isAdmin: false }));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: 'u1', email: 'pat@x.test' } }, isAdmin: auth.isAdmin, isKeeper: true, displayName: 'Pat',
    loading: false, authError: null, clearAuthError: () => {},
  }),
}));

const renderLayout = () => render(<MemoryRouter><Layout /></MemoryRouter>);
// The popover is closed in these tests, so its links are hidden from the accessibility tree.
const adminLinks = () => screen.queryAllByRole('link', { name: /admin/i, hidden: true });

afterEach(cleanup);

describe('Layout', () => {
  it('puts Admin in the account menu for an admin, never in the tab bar', () => {
    auth.isAdmin = true;
    renderLayout();
    expect(adminLinks()).toHaveLength(1);
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', { name: /admin/i })).toBeNull();
    expect(document.getElementById('account-menu')!.contains(adminLinks()[0])).toBe(true);
  });

  it('shows no Admin link to a non-admin', () => {
    auth.isAdmin = false;
    renderLayout();
    expect(adminLinks()).toHaveLength(0);
  });
});
