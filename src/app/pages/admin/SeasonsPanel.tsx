import { useState, type FormEvent } from 'react';
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
            <button className={selected === s.id ? '' : 'secondary'} aria-pressed={selected === s.id} onClick={() => onSelect(s.id)}>
              {selected === s.id ? 'Managing' : 'Manage'}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="row section">
        <label>New season<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring 2027" /></label>
        <button>Create</button>
      </form>
      {(error || seasons.error) && <p className="error" role="alert">{error ?? seasons.error}</p>}
    </div>
  );
}
