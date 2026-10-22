// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startPwa } from '../lib/pwa';
import { Layout } from './Layout';

const auth = vi.hoisted(() => ({ isAdmin: false, displayName: 'Pat' as string | null | undefined }));
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

  it('has three tabs, League, Stats and Leaderboards, for a keeper too (no Tally tab)', () => {
    renderLayout();
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link').map((l) => l.textContent)).toEqual(['League', 'Stats', 'Leaderboards']);
  });

  const current = (path: string) => {
    render(<MemoryRouter initialEntries={[path]}><Layout /></MemoryRouter>);
    return within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page').map((l) => l.textContent);
  };
  it.each([['/player/a?t=S1', 'Stats'], ['/tally?game=s1', 'Stats'], ['/stats/s1', 'Stats'], ['/team/m1', 'Leaderboards'], ['/', 'League']])(
    'lights the right tab on %s', (path, tab) => { expect(current(path)).toEqual([tab]); });
  it('lights no tab on Me', () => { expect(current('/me')).toEqual([]); });

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

  it("doesn't ask for a name while the profile is still loading after sign-in", () => {
    auth.displayName = undefined;
    render(<MemoryRouter><Routes><Route element={<Layout />}><Route index element={<p>league page</p>} /></Route></Routes></MemoryRouter>);
    expect(screen.queryByRole('heading', { name: /what's your name/i })).toBeNull();
    expect(screen.getByText('league page')).toBeTruthy();
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

describe('Install app (t328)', () => {
  beforeAll(() => startPwa());
  afterEach(() => {
    cleanup();
    window.dispatchEvent(new Event('appinstalled')); // drops a prompt a test left behind
    Reflect.deleteProperty(navigator, 'userAgent');
    Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
    vi.unstubAllGlobals();
    auth.isAdmin = false;
  });
  const menu = () => document.getElementById('account-menu')!;
  const installItem = () => screen.queryByRole('button', { name: 'Install app', hidden: true });
  function offer() {
    const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn(async () => {}) });
    act(() => { window.dispatchEvent(e); });
    return e;
  }
  const userAgent = (ua: string) => Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

  it('offers Install app once the browser can install, and prompts once', () => {
    auth.isAdmin = true;
    const hide = vi.fn();
    HTMLElement.prototype.hidePopover = hide; // jsdom has no popover API
    renderLayout();
    expect(installItem()).toBeNull();
    const e = offer();
    expect(e.defaultPrevented).toBe(true); // kept for the menu, not shown by the browser
    const item = installItem()!;
    expect(menu().contains(item)).toBe(true);
    expect([...menu().querySelectorAll('a, button')].map((el) => el.textContent).slice(0, 5))
      .toEqual(['Me', 'Credits', 'Rules', 'Admin', 'Install app']); // then the theme item
    fireEvent.click(item);
    expect(hide).toHaveBeenCalled();
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(installItem()).toBeNull(); // single use
  });

  it('tells iPhone users how to add it to the home screen', () => {
    userAgent(IPHONE);
    renderLayout();
    fireEvent.click(installItem()!);
    const hint = within(menu()).getByText('In Safari, tap Share, then Add to Home Screen.');
    expect(hint.className).toBe('account-hint');
    expect(document.activeElement).toBe(hint); // focus moves to it, so it is read out
    expect(hint.getAttribute('role')).toBeNull(); // no status role too: it would be read out twice
    expect(hint.textContent).toBe('In Safari, tap Share, then Add to Home Screen.');
    expect(installItem()).toBeNull();
  });

  it('offers nothing inside the installed app', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }));
    userAgent(IPHONE);
    renderLayout();
    offer();
    expect(installItem()).toBeNull();
  });

  it('offers nothing where the browser cannot install', () => {
    userAgent(MAC); // a desktop Mac, not an iPad (no touch points)
    renderLayout();
    expect(installItem()).toBeNull();
  });
});
