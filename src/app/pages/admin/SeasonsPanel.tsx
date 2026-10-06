import { useEffect, useState, type FormEvent } from 'react';
import { Loading } from '../../components/Loading';
import { DEFAULT_SETTINGS } from '../../../core/settings';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface SeasonRow { id: string; name: string; status: string }

export function SeasonsPanel({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const seasons = useLoad(async () => {
    const { data, error } = await supabase!.from('seasons').select('id, name, status').order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SeasonRow[];
  }, []);

  // Open on the newest season: nearly every visit manages the current one.
  const newest = seasons.data?.[0]?.id;
  const current = seasons.data?.find((s) => s.id === selected);
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
      {!seasons.data && !seasons.error && <Loading />}
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
      {current && seasons.data && (
        <SeasonEdit key={current.id} season={current} seasons={seasons.data} onRenamed={seasons.reload}
          onDeleted={() => { onSelect(null); seasons.reload(); }} />
      )}
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

/** Rename the managed season, or delete it with everything in it (t213). Delete unlocks once its name is typed. */
function SeasonEdit({ season, seasons, onRenamed, onDeleted }: {
  season: SeasonRow; seasons: SeasonRow[]; onRenamed: () => void; onDeleted: () => void;
}) {
  const [name, setName] = useState(season.name);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The app shows everyone the newest season, so deleting it moves everyone to the next one.
  const after = seasons[0]?.id !== season.id ? null : seasons[1]
    ? `Everyone will see ${seasons[1].name} as the current season.`
    : 'There will be no season until you create one.';

  async function act(fn: () => Promise<void>) {
    setError(null);
    setMsg(null);
    try { await fn(); } catch (err) { setError(errorMessage(err)); }
  }

  return (
    <details className="section">
      <summary>Rename or delete {season.name}</summary>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void act(async () => {
        await api.renameSeason(season.id, name);
        setMsg('Renamed.');
        onRenamed();
      }); }}>
        <label>Name<input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="secondary" disabled={name.trim() === season.name}>Rename season</button>
      </form>
      <form onSubmit={(e) => { e.preventDefault(); void act(async () => {
        await api.deleteSeason(season.id);
        onDeleted();
      }); }}>
        <p className="muted">
          Deleting removes every tournament, league, team, athlete, stat, bid and credit in {season.name}. It can't be
          undone: download a backup first (Backup tab). {after}
        </p>
        <div className="row">
          <label>Type {season.name} to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
          <button className="secondary" disabled={typed !== season.name}>Delete season</button>
        </div>
      </form>
      {msg && <p className="muted" role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </details>
  );
}
