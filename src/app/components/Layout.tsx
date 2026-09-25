import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

export function Layout() {
  const { session, isAdmin, isKeeper, displayName, loading, authError, clearAuthError } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">Tribe Fantasy</Link>
        <nav>
          {isKeeper && <Link to="/tally">Tally</Link>}
          {session && <Link to="/stats">Stats</Link>}
          {session && <Link to="/me">Me</Link>}
          {isAdmin && <Link to="/admin">Admin</Link>}
          {session ? (
            <button className="linklike" onClick={() => supabase?.auth.signOut()}>Sign out</button>
          ) : (
            <Link to="/login">Sign in</Link>
          )}
        </nav>
      </header>
      <main>
        {authError && (
          <p className="error">
            Sign-in link didn't work: {authError}. Request a new link, or use the 6-digit code from the email.{' '}
            <button type="button" className="linklike" onClick={clearAuthError}>Dismiss</button>
          </p>
        )}
        {!loading && session && !displayName && (
          <p className="notice">Welcome! <Link to="/join">Set your name and join a league</Link>.</p>
        )}
        <Outlet />
      </main>
    </div>
  );
}
