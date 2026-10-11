import { useState } from 'react';
import { Loading } from '../../components/Loading';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { passwordProblem } from '../LeaguesPage';

interface LeagueRow {
  id: string;
  name: string;
  created_by: string | null;
  memberships: { id: string; team_name: string }[];
}

/** Every league of the season, with who made it (t215). Anyone creates leagues on /leagues/new; admins delete here. */
export function LeaguesPanel({ seasonId }: { seasonId: string }) {
  const [error, setError] = useState<string | null>(null);
  const leagues = useLoad(async () => {
    const { data, error } = await supabase!
      .from('leagues')
      .select('id, name, created_by, memberships(id, team_name)')
      .eq('season_id', seasonId)
      .order('name');
    if (error) throw error;
    const rows = (data ?? []) as LeagueRow[];
    // created_by points at auth.users, which the API can't embed, so names come from profiles.
    const ids = [...new Set(rows.flatMap((l) => (l.created_by ? [l.created_by] : [])))];
    const names = new Map<string, string>();
    if (ids.length) {
      const res = await supabase!.from('profiles').select('id, display_name').in('id', ids);
      if (res.error) throw res.error;
      for (const p of res.data as { id: string; display_name: string }[]) names.set(p.id, p.display_name);
    }
    // Locked or public: only the current season's list says (the hash itself is private). Older seasons show neither.
    const locked = new Map((await api.listLeagues()).map((l) => [l.id, l.has_password]));
    return rows.map((l) => ({
      ...l, creator: l.created_by ? names.get(l.created_by) ?? 'Unknown' : 'An admin', locked: locked.get(l.id),
    }));
  }, [seasonId]);

  async function remove(l: LeagueRow) {
    const teams = l.memberships.length;
    if (!window.confirm(`Delete ${l.name}? Its ${teams} ${teams === 1 ? 'team' : 'teams'}, their credits, bids and rosters go with it. `
      + "This can't be undone.")) return;
    setError(null);
    try {
      await api.deleteLeague(l.id);
      leagues.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <h2>Leagues</h2>
      {!leagues.data && !leagues.error && <Loading />}
      {leagues.data?.length === 0 && <p className="muted">No leagues in this season yet.</p>}
      <ul className="list">
        {leagues.data?.map((l) => (
          <li key={l.id} className="league-row">
            <div className="who">
              <span className="meta">
                <span className="title">{l.name}</span>
                {l.locked !== undefined && <span className={l.locked ? 'pill' : 'pill info'}>{l.locked ? 'Password' : 'Public'}</span>}
              </span>
              <span className="muted">by {l.creator} · {l.memberships.length} {l.memberships.length === 1 ? 'team' : 'teams'}</span>
              {l.memberships.length > 0 && <small>{l.memberships.map((m) => m.team_name).join(', ')}</small>}
            </div>
            <button className="secondary" aria-label={`Delete ${l.name}`} onClick={() => void remove(l)}>Delete</button>
            <PasswordForm league={l} onSaved={leagues.reload} />
          </li>
        ))}
      </ul>
      {(error || leagues.error) && <p className="error" role="alert">{error ?? leagues.error}</p>}
    </div>
  );
}

/** Admins lock or open any league, including ones they aren't in (older leagues have no creator to do it). */
function PasswordForm({ league, onSaved }: { league: LeagueRow & { locked?: boolean }; onSaved: () => void }) {
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: string | null, done: string) {
    setMsg(null);
    setError(null);
    if (next !== null && passwordProblem(next)) { setError(passwordProblem(next)); return; }
    setBusy(true);
    try {
      await api.setLeaguePassword(league.id, next);
      setPassword('');
      setMsg(done);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); void save(password, `${league.name} now needs a password.`); }}>
      <input aria-label={`New password for ${league.name}`} placeholder="New password" maxLength={40} autoComplete="off"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="secondary" disabled={busy}>Set password</button>
      <button type="button" className="secondary" disabled={busy || league.locked === false} aria-label={`Make ${league.name} public`}
        onClick={() => void save(null, `Anyone can join ${league.name} now.`)}>Make public</button>
      {msg && <p className="success" role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
