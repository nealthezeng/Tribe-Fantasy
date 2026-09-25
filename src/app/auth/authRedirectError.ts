/**
 * Reads a Supabase auth-redirect error description off a returned URL.
 *
 * A failed magic-link/OTP redirect comes back as `?error=...&error_description=...`
 * on the query string, or (for some flows) as a `#error=...&error_description=...`
 * hash fragment. A normal hash route like `#/join` must not be mistaken for one.
 */
export function readAuthRedirectError(search: string, hash: string): string | null {
  const fromSearch = new URLSearchParams(search).get('error_description');
  if (fromSearch) return fromSearch;

  const rest = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!rest) return null;

  const slashIndex = rest.indexOf('/');
  const descIndex = rest.indexOf('error_description=');
  const looksLikeAuthError = rest.startsWith('error=') || (descIndex !== -1 && (slashIndex === -1 || descIndex < slashIndex));
  if (!looksLikeAuthError) return null;

  return new URLSearchParams(rest).get('error_description');
}
