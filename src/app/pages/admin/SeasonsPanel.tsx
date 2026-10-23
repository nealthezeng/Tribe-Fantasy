import { useState, type FormEvent } from 'react';
import { DEFAULT_SETTINGS } from '../../../core/settings';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';

export interface SeasonRow { id: string; name: string; status: string }

/**
 * More › Season: pick the season Admin manages, rename or delete it, or create one. `seasons` is newest first; Admin
 * loads it (it manages the newest without this panel), and `reload` settles once fresh rows land.
 */
export function SeasonsPanel({ seasons, selected, onSelect, reload }: {
  seasons: SeasonRow[]; selected: string | null; onSelect: (id: string) => void; reload: () => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const current = seasons.find((s) => s.id === selected);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const id = await api.createSeason(name, DEFAULT_SETTINGS);
      setName('');
      onSelect(id);
      void reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <h2>Seasons</h2>
      {seasons.length === 0 && <p className="muted">None yet.</p>}
      <ul className="list">
        {seasons.map((s) => (
          <li key={s.id}>
            <span className="meta"><span className="title">{s.name}</span><span className="pill">{s.status}</span></span>
            {selected === s.id
              ? <span className="pill info">Managing</span>
              : <button className="secondary" onClick={() => onSelect(s.id)}>Manage</button>}
          </li>
        ))}
      </ul>
      {current && <SeasonEdit key={current.id} season={current} seasons={seasons} onChanged={reload} />}
      <details className="section" open={seasons.length === 0}>
        <summary>New season</summary>
        <form onSubmit={create} className="row">
          <label>Name<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Spring 2027" /></label>
          <button>Create season</button>
        </form>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/**
 * Rename the managed season, or delete it with everything in it (t213). Delete unlocks once its name is typed, and stays
 * busy until the list without it lands, when Admin falls back to the newest season.
 */
function SeasonEdit({ season, seasons, onChanged }: {
  season: SeasonRow; seasons: SeasonRow[]; onChanged: () => Promise<boolean>;
}) {
  const [name, setName] = useState(season.name);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The app shows everyone the newest season, so deleting it moves everyone to the next one.
  const after = seasons[0]?.id !== season.id ? null : seasons[1]
    ? `Everyone will see ${seasons[1].name} as the current season.`
    : 'There will be no season until you create one.';

  async function act(fn: () => Promise<void>) {
    setError(null);
    setMsg(null);
    setBusy(true);
    try { await fn(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <details className="section">
      <summary>Rename or delete {season.name}</summary>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void act(async () => {
        await api.renameSeason(season.id, name);
        setMsg('Renamed.');
        void onChanged();
      }); }}>
        <label>Name<input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button className="secondary" disabled={busy || name.trim() === season.name}>Rename season</button>
      </form>
      <form onSubmit={(e) => { e.preventDefault(); void act(async () => {
        await api.deleteSeason(season.id);
        await onChanged();
      }); }}>
        <p className="muted">
          Deleting removes every tournament, league, team, athlete, stat, share and credit in {season.name}. It can't be
          undone: download a backup first (Backup tab). {after}
        </p>
        <div className="row">
          <label>Type {season.name} to confirm<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
          <button className="danger-link" disabled={busy || typed !== season.name}>Delete season</button>
        </div>
      </form>
      {msg && <p className="success" role="status">{msg}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </details>
  );
}
