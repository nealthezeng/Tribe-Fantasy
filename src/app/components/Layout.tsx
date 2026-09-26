import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

/** A disc seen from above, in team gold. Same drawing as the favicon in index.html. */
function DiscMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="#f5b700" />
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="#c99400" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3" fill="#8cc8f2" />
    </svg>
  );
}

export function Layout() {
  const { session, isAdmin, isKeeper, displayName, loading, authError, clearAuthError } = useAuth();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="brand"><DiscMark />Tribe Fantasy</Link>
          <nav aria-label="Main">
            {isKeeper && <NavLink to="/tally">Tally</NavLink>}
            {session && <NavLink to="/stats">Stats</NavLink>}
            {session && <NavLink to="/me">Me</NavLink>}
            {isAdmin && <NavLink to="/admin">Admin</NavLink>}
            {session ? (
              <button className="linklike" onClick={() => supabase?.auth.signOut()}>Sign out</button>
            ) : (
              <NavLink to="/login">Sign in</NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="shell">
        {authError && (
          <p className="error" role="alert">
            Sign-in link didn't work: {authError}. Request a new link, or use the 6-digit code from the email.{' '}
            <button type="button" className="linklike" onClick={clearAuthError}>Dismiss</button>
          </p>
        )}
        {!loading && session && !displayName && (
          <p className="notice">Welcome! <Link to="/join">Set your name and join a league</Link>.</p>
        )}
        <Outlet />
      </main>
    </>
  );
}
