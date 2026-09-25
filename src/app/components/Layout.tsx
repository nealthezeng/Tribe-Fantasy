import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';

export function Layout() {
  const { session, isAdmin, displayName, loading } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">Tribe Fantasy</Link>
        <nav>
          {isAdmin && <Link to="/admin">Admin</Link>}
          {session ? (
            <button className="linklike" onClick={() => supabase?.auth.signOut()}>Sign out</button>
          ) : (
            <Link to="/login">Sign in</Link>
          )}
        </nav>
      </header>
      <main>
        {!loading && session && !displayName && (
          <p className="notice">Welcome! <Link to="/join">Set your name and join a league</Link>.</p>
        )}
        <Outlet />
      </main>
    </div>
  );
}
