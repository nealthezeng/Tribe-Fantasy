import { useState, type FormEvent } from 'react';
import { Loading } from '../components/Loading';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { isStandalone } from '../lib/pwa';
import { supabase } from '../lib/supabase';

export function LoginPage() {
  const { session, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (session) return <Navigate to="/" replace />;

  async function sendEmail(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <section className="card">
      <h1>Sign in</h1>
      {!sent ? (
        <form onSubmit={sendEmail}>
          <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <p className="hint">We'll email you a 6-digit code.</p>
          <button disabled={busy}>{busy ? 'Sending…' : 'Email me a code'}</button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <p className="notice">
            Code sent to <strong>{email.trim()}</strong>.
            {/* The installed app has its own storage, and the email's link opens the browser, not the app. */}
            {isStandalone() && ' Type the code from the email here: its link opens your browser, not this app.'}
          </p>
          <label>Code<input className="code" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <button disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
          <button type="button" className="linklike" onClick={() => setSent(false)}>Use a different email</button>
        </form>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
