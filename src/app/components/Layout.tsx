import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { resolveAvatar } from '../lib/avatar';
import { Avatar } from './Avatar';
import { errorMessage } from '../lib/errors';
import { isIos, isStandalone, promptInstall, useCanInstall } from '../lib/pwa';
import { api } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { useInk } from '../lib/useInk';

/** A disc seen from above, in team gold. Colours come from tokens.css; the favicon in index.html repeats them. */
function DiscMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="disc-body" cx="12" cy="12" r="11" />
      <circle className="disc-ring" cx="12" cy="12" r="7.5" strokeWidth="1.5" />
      <circle className="disc-hub" cx="12" cy="12" r="3" />
    </svg>
  );
}

const INSTALL_SEEN = 'tribe.install.seen';

/** Avatar button that opens Me, My credits, Rules, Admin, Install app and Sign out. A native popover handles Esc, tap-outside and focus. */
function AccountMenu({ name, email, isAdmin, uid, avatar }: { name: string | null; email: string | undefined; isAdmin: boolean; uid: string; avatar: unknown }) {
  const menu = useRef<HTMLDivElement>(null);
  const path = useLocation().pathname;
  const onMenuPage = path === '/me' || path === '/credits' || path.startsWith('/admin');
  const close = () => menu.current?.hidePopover();
  const initial = (name || email || '?').trim().charAt(0).toUpperCase();
  // index.html set the theme before first paint; this flips it and remembers the choice on this device.
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark');
  function flipTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* storage blocked: lasts until reload */ }
    setTheme(next);
  }
  // Install app: the browser's own dialog where it offers one, the Add to Home Screen hint on an iPhone/iPad.
  const canPrompt = useCanInstall();
  const [hint, setHint] = useState(false);
  // Focus moves to the hint when it replaces the button, so a screen reader reads it (and focus isn't lost).
  const hintRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (hint) hintRef.current?.focus(); }, [hint]);
  const install = () => {
    if (canPrompt) { close(); promptInstall(); } else setHint(true);
  };
  // On the website (not inside the installed app) where it can be installed: Install app leads the menu with a glowing
  // gold dot, and the avatar carries the same dot until the menu has been opened once on this device.
  const canInstall = !isStandalone() && (canPrompt || isIos());
  const [nudge, setNudge] = useState(() => { try { return localStorage.getItem(INSTALL_SEEN) !== '1'; } catch { return true; } });
  const opened = () => {
    setNudge(false);
    try { localStorage.setItem(INSTALL_SEEN, '1'); } catch { /* shows again next visit */ }
  };
  return (
    <div className="account">
      <button className="account-button" popoverTarget="account-menu" aria-label="Account menu"
        aria-current={onMenuPage ? 'page' : undefined}>
        {/* The initial until the profile has loaded, so nobody's generated figure flashes before their saved one. */}
        {avatar === undefined
          ? <span className="avatar" aria-hidden="true">{initial}</span>
          : <span className="avatar has-figure"><Avatar choice={resolveAvatar(avatar, uid)} /></span>}
        {canInstall && nudge && <span className="needs glow"><span className="sr-only"> (you can install the app)</span></span>}
      </button>
      <div id="account-menu" className="account-menu" popover="auto" ref={menu} onToggle={(e) => { if (canInstall && e.newState === 'open') opened(); }}>
        <p className="account-who">
          <strong>{name || 'No name yet'}</strong>
          <small>{email}</small>
        </p>
        {hint
          ? <p className="account-hint" tabIndex={-1} ref={hintRef}>Tap Share, then Add to Home Screen.</p>
          : canInstall && <button type="button" className="install" onClick={install}>Install app<span className="needs glow" aria-hidden="true" /></button>}
        <NavLink to="/me" onClick={close}>Me</NavLink>
        <NavLink to="/credits" onClick={close}>My credits</NavLink>
        <NavLink to="/rules" onClick={close}>Rules</NavLink>
        {isAdmin && <NavLink to="/admin" onClick={close}>Admin</NavLink>}
        <button type="button" onClick={flipTheme}>{theme === 'light' ? 'Dark mode' : 'Light mode'}</button>
        <button type="button" onClick={() => { close(); void supabase?.auth.signOut(); }}>Sign out</button>
      </div>
    </div>
  );
}

/**
 * The "Your name" field. First sign-in asks for a name before anything else, so staff can find (and make keepers of)
 * people outside any league; the Me page changes it.
 */
export function NameForm({ current = '' }: { current?: string }) {
  const { refresh } = useAuth();
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await api.setDisplayName(name);
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }
  return (
    <form onSubmit={submit}>
      <label>Your name<input required maxLength={60} autoComplete="name" value={name}
        onChange={(e) => { setName(e.target.value); setSaved(false); }} /></label>
      <button disabled={busy}>{busy ? 'Saving…' : 'Save name'}</button>
      {saved && <small className="success" role="status">Saved.</small>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

/** Which tab a path lights. Player, tally and team pages sit under Stats / Leaderboards; Me, Credits, Rules and Admin light none. */
const tabOf = (path: string) =>
  path === '/' ? '/' : /^\/(stats|player|tally)(\/|$)/.test(path) ? '/stats' : /^\/(leaderboards|team)(\/|$)/.test(path) ? '/leaderboards' : null;

export function Layout() {
  const { session, isAdmin, displayName, avatar, loading, authError, clearAuthError } = useAuth();
  const path = useLocation().pathname;
  const tab = tabOf(path);
  const tabs = useInk<HTMLElement>(`${path} ${Boolean(session)}`);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand"><DiscMark />Tribe Fantasy</Link>
          {session && (
            <nav className="tabs" aria-label="Main" ref={tabs}>
              {/* Each tab's drawn icon (a disc, bars, a cup) shows over its label in the phone dock only. */}
              {([['/', 'League', <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /></>],
                ['/stats', 'Stats', <path d="M5 20V10M12 20V4M19 20v-7" />],
                ['/leaderboards', 'Leaderboards', <path d="M8 4h8v5a4 4 0 0 1-8 0zM12 13v5M8 20h8" />]] as const).map(([to, label, icon]) => (
                <Link key={to} to={to} aria-current={tab === to ? 'page' : undefined}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">{icon}</svg>{label}
                </Link>
              ))}
              <span className="ink" aria-hidden="true" />
            </nav>
          )}
          {session
            ? <AccountMenu name={displayName ?? null} email={session.user.email} isAdmin={isAdmin} uid={session.user.id} avatar={avatar} />
            : <NavLink to="/login" className="signin">Sign in</NavLink>}
        </div>
      </header>
      <main className="shell">
        {authError && (
          <p className="error" role="alert">
            Sign-in link didn't work: {authError}. Use the code instead.{' '}
            <button type="button" className="linklike" onClick={clearAuthError}>Dismiss</button>
          </p>
        )}
        {!loading && session && displayName === null
          ? <section className="card"><h1>What's your name?</h1><NameForm /></section>
          : <Outlet />}
      </main>
    </>
  );
}
