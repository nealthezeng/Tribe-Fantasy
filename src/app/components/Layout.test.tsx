// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './Layout';

const auth = vi.hoisted(() => ({ isAdmin: false, displayName: 'Pat' as string | null }));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    session: { user: { id: 'u1', email: 'pat@x.test' } }, isAdmin: auth.isAdmin, isKeeper: true, displayName: auth.displayName,
    loading: false, authError: null, clearAuthError: () => {},
  }),
}));

const renderLayout = () => render(<MemoryRouter><Layout /></MemoryRouter>);
// The popover is closed in these tests, so its links are hidden from the accessibility tree.
const adminLinks = () => screen.queryAllByRole('link', { name: /admin/i, hidden: true });

afterEach(() => {
  cleanup();
  auth.displayName = 'Pat';
});

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

  it('asks a signed-in user with no name for one before anything else, league or not (t119)', () => {
    auth.displayName = null;
    render(<MemoryRouter><Routes><Route element={<Layout />}><Route index element={<p>league page</p>} /></Route></Routes></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /what's your name/i })).toBeTruthy();
    expect(screen.getByLabelText(/your name/i)).toBeTruthy();
    expect(screen.queryByText('league page')).toBeNull();
  });

  it('flips between dark and light from the account menu and remembers it (t118)', () => {
    document.documentElement.dataset.theme = 'dark';
    renderLayout();
    fireEvent.click(screen.getByRole('button', { name: 'Light mode', hidden: true }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'Dark mode', hidden: true }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
