import { useState } from 'react';
import { Loading } from '../../components/Loading';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { teamLabel } from '../../lib/tournament';
import { useLoad } from '../../lib/useLoad';
import { passwordProblem } from '../LeaguesPage';
import { LeagueBrowser } from './LeagueBrowser';

interface LeagueRow {
  id: string;
  name: string;
  created_by: string | null;
  memberships: { id: string; team_name: string; removed_at: string | null }[];
}
type League = LeagueRow & { live: number; creator: string; locked?: boolean };

/** Every league of the season, with who made it (t215). Anyone creates leagues on /leagues/new; admins delete here. */
export function LeaguesPanel({ seasonId }: { seasonId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const leagues = useLoad(async (): Promise<League[]> => {
    const { data, error } = await supabase!
      .from('leagues')
      .select('id, name, created_by, memberships(id, team_name, removed_at)')
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
      ...l, live: l.memberships.filter((m) => m.removed_at === null).length,
      creator: l.created_by ? names.get(l.created_by) ?? 'a removed user' : 'an admin', locked: locked.get(l.id),
    }));
  }, [seasonId]);

  if (open) return <LeagueBrowser seasonId={seasonId} leagueId={open} onClose={() => setOpen(null)} />;
  return (
    <div className="card">
      <h2>Leagues</h2>
      {!leagues.data && !leagues.error && <Loading />}
      {leagues.data?.length === 0 && <p className="muted">No leagues in this season yet.</p>}
      <ul className="list">
        {leagues.data?.map((l) => <LeagueItem key={l.id} league={l} onOpen={() => setOpen(l.id)} onChanged={leagues.reload} />)}
      </ul>
      {leagues.error && <p className="error" role="alert">{leagues.error}</p>}
    </div>
  );
}

/** One league as a row that opens its actions (P9 rule 1): its teams, the browser, the password, and Delete last. */
function LeagueItem({ league: l, onOpen, onChanged }: { league: League; onOpen: () => void; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const teams = l.memberships.length;
    if (!window.confirm(`Delete ${l.name}? Its ${teams} ${teams === 1 ? 'team' : 'teams'}, their credits, shares and rosters go with it. `
      + "This can't be undone.")) return;
    setError(null);
    try {
      await api.deleteLeague(l.id);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <li>
      <details name="admin-league">
        <summary className="row-link">
          <span className="who">
            <b>{l.name}</b>
            {l.locked !== undefined && <small>{l.locked ? 'Needs a password' : 'Open to anyone'}</small>}
            <small>{l.live} {l.live === 1 ? 'team' : 'teams'} · Made by {l.creator}</small>
          </span>
        </summary>
        <div className="stack">
          {l.memberships.length > 0 && <p>{l.memberships.map(teamLabel).join(', ')}</p>}
          <button className="secondary" onClick={onOpen}>Open league</button>
          <PasswordForm league={l} onSaved={onChanged} />
          <button className="danger-link" onClick={() => void remove()}>Delete league</button>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </details>
    </li>
  );
}

/** Admins lock or open any league, including ones they aren't in (older leagues have no creator to do it). */
function PasswordForm({ league, onSaved }: { league: League; onSaved: () => void }) {
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
    <>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void save(password, `${league.name} now needs a password.`); }}>
        <label>New password
          <input maxLength={40} autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="secondary" disabled={busy}>{league.locked ? 'Change password' : 'Add a password'}</button>
        {/* An older season's lock is unknown, so it keeps Remove password, as it kept Make public before. */}
        {league.locked !== false && (
          <button type="button" className="secondary" disabled={busy}
            onClick={() => void save(null, `Anyone can join ${league.name} now.`)}>Remove password</button>
        )}
      </form>
      {msg && <p className="success" role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
