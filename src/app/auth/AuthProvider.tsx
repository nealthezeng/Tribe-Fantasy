import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { readAuthRedirectError } from './authRedirectError';

interface AuthState {
  session: Session | null;
  loading: boolean;
  displayName: string | null;
  isAdmin: boolean;
  isKeeper: boolean; // stat_keeper or admin
  authError: string | null;
  clearAuthError: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isKeeper, setIsKeeper] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  const loadProfile = useCallback(async (s: Session | null) => {
    const uid = s?.user.id ?? null;
    if (loadedFor.current !== uid) {
      // A different user (or none): drop the last user's name and roles before a fetch that might fail.
      loadedFor.current = uid;
      setDisplayName(null);
      setIsAdmin(false);
      setIsKeeper(false);
    }
    if (!supabase || !s || !uid) return;
    const [profile, roles] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', uid),
    ]);
    // A failed fetch (e.g. on an hourly token refresh) keeps what we knew: it mustn't drop a keeper out of tallying.
    if (profile.error || roles.error) return;
    setDisplayName(profile.data?.display_name ?? null);
    const roleNames = (roles.data ?? []).map((r: { role: string }) => r.role);
    setIsAdmin(roleNames.includes('admin'));
    setIsKeeper(roleNames.includes('admin') || roleNames.includes('stat_keeper'));
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const clearUrl = () => window.history.replaceState(null, '', window.location.pathname + '#/');
    const hadCode = new URLSearchParams(window.location.search).has('code');
    const redirectError = readAuthRedirectError(window.location.search, window.location.hash);
    if (redirectError) {
      setAuthError(redirectError);
      clearUrl();
    }
    supabase.auth.getSession().then(async ({ data }) => {
      if (hadCode && !data.session) {
        // PKCE: the code verifier lives in the browser that requested the link, so supabase-js skipped the exchange.
        setAuthError(
          'This sign-in link was opened in a different browser than the one you requested it from. Type the 6-digit code from the email in the original browser, or request a new link here.',
        );
        clearUrl();
      }
      setSession(data.session);
      await loadProfile(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // Supabase advises against awaiting other client calls inside this callback.
      setTimeout(() => void loadProfile(s), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const refresh = useCallback(() => loadProfile(session), [loadProfile, session]);
  const clearAuthError = useCallback(() => setAuthError(null), []);

  return (
    <AuthContext.Provider value={{ session, loading, displayName, isAdmin, isKeeper, authError, clearAuthError, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
