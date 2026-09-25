import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { readAuthRedirectError } from './authRedirectError';

interface AuthState {
  session: Session | null;
  loading: boolean;
  displayName: string | null;
  isAdmin: boolean;
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
  const [authError, setAuthError] = useState<string | null>(null);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!supabase || !s) {
      setDisplayName(null);
      setIsAdmin(false);
      return;
    }
    const uid = s.user.id;
    const [profile, roles] = await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', uid).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', uid),
    ]);
    setDisplayName(profile.data?.display_name ?? null);
    setIsAdmin((roles.data ?? []).some((r: { role: string }) => r.role === 'admin'));
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const redirectError = readAuthRedirectError(window.location.search, window.location.hash);
    if (redirectError) {
      setAuthError(redirectError);
      window.history.replaceState(null, '', window.location.pathname + '#/');
    }
    supabase.auth.getSession().then(async ({ data }) => {
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
    <AuthContext.Provider value={{ session, loading, displayName, isAdmin, authError, clearAuthError, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
