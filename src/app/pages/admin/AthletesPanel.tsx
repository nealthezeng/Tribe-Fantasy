import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface AthleteRow { id: string; name: string; opted_in: boolean; user_id: string | null }
interface ProfileRow { id: string; display_name: string }

export function AthletesPanel({ seasonId }: { seasonId: string }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const athletes = useLoad(async () => {
    const [athletes, profiles] = await Promise.all([
      supabase!.from('athletes').select('id, name, opted_in, user_id').eq('season_id', seasonId).order('name'),
      supabase!.from('profiles').select('id, display_name').order('display_name'),
    ]);
    if (athletes.error) throw athletes.error;
    if (profiles.error) throw profiles.error;
    return { list: (athletes.data ?? []) as AthleteRow[], profiles: (profiles.data ?? []) as ProfileRow[] };
  }, [seasonId]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      athletes.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api.addAthlete(seasonId, name);
      setName('');
    });
  }

  const count = athletes.data?.list.filter((a) => a.opted_in).length ?? 0;
  return (
    <div className="card">
      <h2>Athletes <small>({count} opted in)</small></h2>
      <ul className="list">
        {athletes.data?.list.map((a) => (
          <li key={a.id}>
            <span style={{ opacity: a.opted_in ? 1 : 0.5 }}>{a.name}</span>
            <select aria-label={`Account for ${a.name}`} value={a.user_id ?? ''}
              onChange={(e) => void run(() => api.linkAthleteUser(a.id, e.target.value || null))}>
              <option value="">No linked account</option>
              {athletes.data?.profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </select>
            <button className="linklike" onClick={() => void run(() => api.setAthleteOptIn(a.id, !a.opted_in))}>
              {a.opted_in ? 'Opt out' : 'Opt back in'}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="row">
        <label>Add athlete<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button>Add</button>
      </form>
      {(error || athletes.error) && <p className="error">{error ?? athletes.error}</p>}
    </div>
  );
}
