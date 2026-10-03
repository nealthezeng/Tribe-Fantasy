import { useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { useInk } from '../lib/useInk';

/** A disc seen from above, in team gold. Colours come from tokens.css; the favicon in index.html repeats them. */
export function DiscMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
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
        <NavLink to="/me" onClick={close}>Me<small>Attendance and injuries</small></NavLink>
        <NavLink to="/rules" onClick={close}>Rules<small>How scoring works</small></NavLink>
        {isAdmin && <NavLink to="/admin" onClick={close}>Admin<small>Seasons, leagues, athletes</small></NavLink>}
        <button type="button" onClick={() => { close(); void supabase?.auth.signOut(); }}>Sign out</button>
      </div>
    </div>
  );
}

export function Layout() {
  const { session, isAdmin, isKeeper, displayName, loading, authError, clearAuthError } = useAuth();
  const path = useLocation().pathname;
  const onHome = path === '/';
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
        {onHome && !loading && session && !displayName && (
          <p className="notice">Welcome! <Link to="/join">Set your name and join a league</Link>.</p>
        )}
        <Outlet />
      </main>
    </>
  );
}
