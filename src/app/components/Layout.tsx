import { useRef, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
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

/** Avatar button that opens Me, Rules, Admin and Sign out. A native popover handles Esc, tap-outside and focus. */
function AccountMenu({ name, email, isAdmin }: { name: string | null; email: string | undefined; isAdmin: boolean }) {
  const menu = useRef<HTMLDivElement>(null);
  const path = useLocation().pathname;
  const onMenuPage = path === '/me' || path.startsWith('/admin');
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
  return (
    <div className="account">
      <button className="account-button" popoverTarget="account-menu" aria-label="Account menu"
        aria-current={onMenuPage ? 'page' : undefined}>
        <span className="avatar" aria-hidden="true">{initial}</span>
      </button>
      <div id="account-menu" className="account-menu" popover="auto" ref={menu}>
        <p className="account-who">
          <strong>{name || 'No name yet'}</strong>
          <small>{email}</small>
        </p>
        <NavLink to="/me" onClick={close}>Me</NavLink>
        <NavLink to="/rules" onClick={close}>Rules</NavLink>
        {isAdmin && <NavLink to="/admin" onClick={close}>Admin</NavLink>}
        <button type="button" onClick={flipTheme}>{theme === 'light' ? 'Dark mode' : 'Light mode'}</button>
        <button type="button" onClick={() => { close(); void supabase?.auth.signOut(); }}>Sign out</button>
      </div>
    </div>
  );
}

/** First sign-in: a name before anything else, so staff can find (and make keepers of) people outside any league. */
function NameForm() {
  const { refresh } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setDisplayName(name);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h1>What's your name?</h1>
      <form onSubmit={submit}>
        <label>Your name<input required maxLength={60} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button disabled={busy}>{busy ? 'Saving…' : 'Save name'}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}

export function Layout() {
  const { session, isAdmin, isKeeper, displayName, loading, authError, clearAuthError } = useAuth();
  const path = useLocation().pathname;
  const tabs = useInk<HTMLElement>(`${path} ${isKeeper} ${Boolean(session)}`);
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand"><DiscMark />Tribe Fantasy</Link>
          {session && (
            <nav className="tabs" aria-label="Main" ref={tabs}>
              <NavLink to="/" end>League</NavLink>
              <NavLink to="/stats">Stats</NavLink>
              {isKeeper && <NavLink to="/tally">Tally</NavLink>}
              <span className="ink" aria-hidden="true" />
            </nav>
          )}
          {session
            ? <AccountMenu name={displayName} email={session.user.email} isAdmin={isAdmin} />
            : <NavLink to="/login" className="signin">Sign in</NavLink>}
        </div>
      </header>
      <main className="shell">
        {authError && (
          <p className="error" role="alert">
            Sign-in link didn't work: {authError}. Request a new link, or use the 6-digit code from the email.{' '}
            <button type="button" className="linklike" onClick={clearAuthError}>Dismiss</button>
          </p>
        )}
        {!loading && session && !displayName ? <NameForm /> : <Outlet />}
      </main>
    </>
  );
}
