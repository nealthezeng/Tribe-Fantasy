import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';

export function JoinPage() {
  const { session, loading, displayName, refresh } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <p className="muted" role="status">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!displayName) {
        await api.setDisplayName(name);
        await refresh();
      }
      await api.joinLeague(code, team);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h1>Join a league</h1>
      <form onSubmit={submit}>
        {!displayName && (
          <label>Your name<input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        )}
        <label>Invite code<input className="code" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} /></label>
        <label>Team name<input required maxLength={40} value={team} onChange={(e) => setTeam(e.target.value)} /></label>
        <button disabled={busy}>{busy ? 'Joining…' : 'Join league'}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
