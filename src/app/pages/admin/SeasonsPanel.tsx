import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_SETTINGS } from '../../../core/settings';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface SeasonRow { id: string; name: string; status: string }

export function SeasonsPanel({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const seasons = useLoad(async () => {
    const { data, error } = await supabase!.from('seasons').select('id, name, status').order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SeasonRow[];
  }, []);

  // Open on the newest season: nearly every visit manages the current one.
  const newest = seasons.data?.[0]?.id;
  useEffect(() => { if (!selected && newest) onSelect(newest); }, [selected, newest, onSelect]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const id = await api.createSeason(name, DEFAULT_SETTINGS);
      setName('');
      seasons.reload();
      onSelect(id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <h2>Seasons</h2>
      {!seasons.data && !seasons.error && <p className="muted" role="status">Loading…</p>}
      {seasons.data?.length === 0 && <p className="muted">No seasons yet. Create the first one below.</p>}
      <ul className="list">
        {seasons.data?.map((s) => (
          <li key={s.id}>
            <span className="meta"><span className="title">{s.name}</span><span className="pill">{s.status}</span></span>
            {selected === s.id
              ? <span className="pill info">Managing</span>
              : <button className="secondary" onClick={() => onSelect(s.id)}>Manage</button>}
          </li>
        ))}
      </ul>
      <details className="section" open={seasons.data?.length === 0}>
        <summary>New season</summary>
        <form onSubmit={create} className="row">
          <label>Name<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring 2027" /></label>
          <button>Create season</button>
        </form>
      </details>
      {(error || seasons.error) && <p className="error" role="alert">{error ?? seasons.error}</p>}
    </div>
  );
}
