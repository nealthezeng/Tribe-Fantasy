import { useState, type FormEvent } from 'react';
import { randomCode } from '../../lib/codes';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface LeagueRow {
  id: string;
  name: string;
  invites: { code: string; uses: number; max_uses: number; expires_at: string | null }[];
  memberships: { id: string; team_name: string }[];
}

export function LeaguesPanel({ seasonId }: { seasonId: string }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const leagues = useLoad(async () => {
    const { data, error } = await supabase!
      .from('leagues')
      .select('id, name, invites(code, uses, max_uses, expires_at), memberships(id, team_name)')
      .eq('season_id', seasonId)
      .order('name');
    if (error) throw error;
    return (data ?? []) as LeagueRow[];
  }, [seasonId]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      leagues.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api.createLeague(seasonId, name);
      setName('');
    });
  }

  return (
    <div className="card">
      <h2>Leagues and invites</h2>
      {!leagues.data && !leagues.error && <p className="muted" role="status">Loading…</p>}
      {leagues.data?.length === 0 && <p className="muted">No leagues in this season yet.</p>}
      {leagues.data?.map((l) => (
        <div key={l.id} className="section">
          <h3>{l.name} <small>{l.memberships.length} teams</small></h3>
          <ul className="list">
            {l.invites.map((i) => (
              <li key={i.code}>
                <code className="code">{i.code}</code>
                <span className="muted num">{i.uses}/{i.max_uses} used{i.expires_at ? ` · expires ${new Date(i.expires_at).toLocaleDateString()}` : ''}</span>
              </li>
            ))}
          </ul>
          {l.memberships.length > 0 && <p><span className="muted">Teams:</span> {l.memberships.map((m) => m.team_name).join(', ')}</p>}
          <button className="secondary" onClick={() => void run(() => api.createInvite(l.id, randomCode(), 50, null))}>New invite code</button>
        </div>
      ))}
      <form onSubmit={create} className="row section">
        <label>New league<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="League A" /></label>
        <button>Create</button>
      </form>
      {(error || leagues.error) && <p className="error" role="alert">{error ?? leagues.error}</p>}
    </div>
  );
}
