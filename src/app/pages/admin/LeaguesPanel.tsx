import { useState } from 'react';
import { Loading } from '../../components/Loading';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

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
    return rows.map((l) => ({ ...l, creator: l.created_by ? names.get(l.created_by) ?? 'Unknown' : 'An admin' }));
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
      <p className="muted">Anyone signed in can create a league (one per season) or join one from the Join a league page.</p>
      {!leagues.data && !leagues.error && <Loading />}
      {leagues.data?.length === 0 && <p className="muted">No leagues in this season yet.</p>}
      <ul className="list">
        {leagues.data?.map((l) => (
          <li key={l.id}>
            <span className="meta">
              <span className="title">{l.name}</span>
              <span className="muted">by {l.creator} · {l.memberships.length} {l.memberships.length === 1 ? 'team' : 'teams'}</span>
            </span>
            <button className="secondary" aria-label={`Delete ${l.name}`} onClick={() => void remove(l)}>Delete</button>
            {l.memberships.length > 0 && <small className="muted">{l.memberships.map((m) => m.team_name).join(', ')}</small>}
          </li>
        ))}
      </ul>
      {(error || leagues.error) && <p className="error" role="alert">{error ?? leagues.error}</p>}
    </div>
  );
}
