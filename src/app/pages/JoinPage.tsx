import { useState, type FormEvent } from 'react';
import { Loading } from '../components/Loading';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';

export function JoinPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
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
        <label>Invite code<input className="code" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} /></label>
        <label>Team name<input required maxLength={40} value={team} onChange={(e) => setTeam(e.target.value)} /></label>
        <button disabled={busy}>{busy ? 'Joining…' : 'Join league'}</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
