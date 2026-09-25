import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** null when the build has no Supabase config (the site then explains it isn't connected). */
export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } })
    : null;
