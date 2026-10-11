import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../components/Loading';
import { errorMessage } from '../lib/errors';
import { api, type LeagueListing } from '../lib/rpc';
import { useLoad } from '../lib/useLoad';

/** The server reads a blank password as "public", so a password of only spaces must be refused here, not saved. */
export const passwordProblem = (password: string) =>
  password.trim().length < 4 ? errorMessage({ message: 'INVALID_PASSWORD' }) : null;

/** /leagues (t215): the current season's leagues, searchable by name; tap Join for a team name (+ password). */
export function LeaguesPage() {
  const { session, loading } = useAuth();
  const uid = session?.user.id;
  const leagues = useLoad(async () => (uid ? api.listLeagues() : undefined), [uid]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  const q = query.trim().toLowerCase();
  const shown = leagues.data?.filter((l) => l.name.toLowerCase().includes(q));

  return (
    <section className="page">
      <h1>Join a league</h1>
      <div className="card">
        <label>Search leagues<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" /></label>
        {leagues.error && <p className="error" role="alert">{leagues.error}</p>}
        {!leagues.data && !leagues.error && <Loading />}
        {leagues.data?.length === 0 && <p className="muted">No leagues yet. Create the first one.</p>}
        {!!leagues.data?.length && shown?.length === 0 && <p className="muted">No league matches "{query.trim()}".</p>}
        <ul className="list">
          {shown?.map((l) => (
            <LeagueRow key={l.id} league={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} />
          ))}
        </ul>
      </div>
      <p><Link to="/leagues/new" className="more">Create a league</Link></p>
    </section>
  );
}

function LeagueRow({ league: l, open, onToggle }: { league: LeagueListing; open: boolean; onToggle: () => void }) {
  const navigate = useNavigate();
  const [team, setTeam] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = l.teams >= l.max_teams;

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.joinOpenLeague(l.id, l.has_password ? password : null, team);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <li>
      <span className="meta">
        <span className="title">{l.name}</span>
        {l.has_password && <span className="pill">Password</span>}
      </span>
      <span className="meta">
        <span className="muted num">{l.teams} of {l.max_teams} teams</span>
        {l.is_member ? <span className="pill ok">Joined</span>
          : full ? <span className="pill">Full</span>
          : <button className="secondary" aria-expanded={open} aria-label={`Join ${l.name}`} onClick={onToggle}>Join</button>}
      </span>
      {open && !l.is_member && !full && (
        <form className="row" onSubmit={join}>
          <label>Your team name<input required maxLength={40} value={team} onChange={(e) => setTeam(e.target.value)} /></label>
          {l.has_password && (
            <label>Password<input type="password" required autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          )}
          <button disabled={busy}>{busy ? 'Joining…' : 'Join league'}</button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      )}
    </li>
  );
}

/** /leagues/new (t215): anyone makes a league of the current season and joins it as its first team. */
export function CreateLeaguePage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [team, setTeam] = useState('');
  const [locked, setLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const bad = locked && passwordProblem(password);
    if (bad) { setError(bad); return; }
    setBusy(true);
    setError(null);
    try {
      await api.createMyLeague(name, locked ? password : null, team);
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <h1>Create a league</h1>
      <form className="card" onSubmit={submit}>
        <label>League name<input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Your team name<input required maxLength={40} value={team} onChange={(e) => setTeam(e.target.value)} /></label>
        <label className="check">
          <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
          Needs a password to join
        </label>
        {locked && (
          <label>Password<input required minLength={4} maxLength={40} autoComplete="off" value={password}
            onChange={(e) => setPassword(e.target.value)} /></label>
        )}
        <button disabled={busy}>{busy ? 'Creating…' : 'Create league'}</button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
      <p><Link to="/leagues" className="more">Join a league instead</Link></p>
    </section>
  );
}

/** On Home, inside League settings, for the league's creator (or an admin): rename, set or remove the password, delete
 *  while theirs is the only team. `children` (Leave) sits with Delete. */
export function ManageLeague({ league, onChanged, children }: { league: LeagueListing; onChanged: () => void; children?: ReactNode }) {
  const { isAdmin } = useAuth();
  const [name, setName] = useState(league.name);
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<void>, done: string) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      setMsg(done);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <form className="row" onSubmit={(e) => { e.preventDefault(); void act(() => api.renameLeague(league.id, name), 'Renamed.'); }}>
        <label>League name<input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="secondary" disabled={busy || name.trim() === league.name}>Rename league</button>
      </form>
      <form className="row section" onSubmit={(e) => {
        e.preventDefault();
        const bad = passwordProblem(password);
        if (bad) { setMsg(null); setError(bad); return; }
        void act(async () => { await api.setLeaguePassword(league.id, password); setPassword(''); }, 'Password saved.');
      }}>
        <label>{league.has_password ? 'New password' : 'Password'}
          <input required minLength={4} maxLength={40} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="secondary" disabled={busy}>{league.has_password ? 'Change password' : 'Add password'}</button>
        {league.has_password && (
          <button type="button" className="secondary" disabled={busy}
            onClick={() => void act(() => api.setLeaguePassword(league.id, null), 'Anyone can join now.')}>Remove password</button>
        )}
      </form>
      <div className="section">
        {children}
        {league.teams === 1 ? (
          <button className="secondary" disabled={busy} onClick={() => {
            if (!window.confirm(`Delete ${league.name}? Your team and its credits go with it. This can't be undone.`)) return;
            void act(() => api.deleteLeague(league.id), 'Deleted.');
          }}>Delete league</button>
        ) : <p className="muted">{isAdmin ? 'Delete it from Admin → Leagues.' : 'Only an admin can delete a league others have joined.'}</p>}
      </div>
      {msg && <p className="success" role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** On Home, under each of your teams (t217). The server refuses once the team has donated, bid, or been paired for a
 *  game; a donation is known here, so the button isn't offered then. The last team to leave takes the league with it,
 *  whoever created it. */
export function LeagueLeave({ membershipId, league, donated = false, onLeft }: {
  membershipId: string; league: LeagueListing; donated?: boolean; onLeft: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (donated) return null;

  async function leave() {
    setBusy(true);
    setError(null);
    // Count teams afresh: others may have joined or left since Home loaded.
    const teams = (await api.listLeagues().catch(() => [])).find((l) => l.id === league.id)?.teams ?? league.teams;
    const alone = teams <= 1 ? ` ${league.name} will be deleted too, since yours is its only team.` : '';
    if (!window.confirm(`Leave ${league.name}? Your team and its credits are removed.${alone}`)) { setBusy(false); return; }
    try {
      await api.leaveLeague(membershipId);
      onLeft();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="secondary" disabled={busy} onClick={() => void leave()}>Leave {league.name}</button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
