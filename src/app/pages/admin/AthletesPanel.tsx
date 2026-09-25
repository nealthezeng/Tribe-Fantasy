import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface AthleteRow { id: string; name: string; opted_in: boolean }

export function AthletesPanel({ seasonId }: { seasonId: string }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const athletes = useLoad(async () => {
    const { data, error } = await supabase!.from('athletes').select('id, name, opted_in').eq('season_id', seasonId).order('name');
    if (error) throw error;
    return (data ?? []) as AthleteRow[];
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

  const count = athletes.data?.filter((a) => a.opted_in).length ?? 0;
  return (
    <div className="card">
      <h2>Athletes <small>({count} opted in)</small></h2>
      <ul className="list">
        {athletes.data?.map((a) => (
          <li key={a.id}>
            <span style={{ opacity: a.opted_in ? 1 : 0.5 }}>{a.name}</span>
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
