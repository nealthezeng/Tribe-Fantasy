import { useState, type FormEvent } from 'react';
import { Loading } from '../../components/Loading';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface AthleteRow { id: string; name: string; opted_in: boolean; user_id: string | null }
interface ProfileRow { id: string; display_name: string }

/** The season's players, one row each (P9 rule 1): the row opens its account link, opt-out, name and removal. */
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

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.addAthlete(seasonId, name);
      setName('');
      athletes.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const count = athletes.data?.list.filter((a) => a.opted_in).length ?? 0;
  return (
    <div className="card">
      <h2>Players <small>{count} opted in</small></h2>
      {!athletes.data && !athletes.error && <Loading />}
      {athletes.data?.list.length === 0 && <p className="muted">None yet.</p>}
      <ul className="list">
        {athletes.data?.list.map((a) => <Player key={a.id} a={a} profiles={athletes.data!.profiles} reload={athletes.reload} />)}
      </ul>
      <form onSubmit={add} className="row section">
        <label>Add player<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button>Add</button>
      </form>
      {(error || athletes.error) && <p className="error" role="alert">{error ?? athletes.error}</p>}
    </div>
  );
}

function Player({ a, profiles, reload }: { a: AthleteRow; profiles: ProfileRow[]; reload: () => void }) {
  const [name, setName] = useState(a.name);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function rename(e: FormEvent) {
    e.preventDefault();
    void run(() => api.renameAthlete(a.id, name));
  }

  function remove() {
    if (!window.confirm(`Remove ${a.name}? This can't be undone.`)) return;
    void run(async () => {
      try {
        await api.deleteAthlete(a.id);
      } catch (err) {
        // Has history: only an explicit second yes wipes it (t81).
        if ((err as { message?: string })?.message !== 'ATHLETE_IN_USE') throw err;
        if (!window.confirm(`${a.name} has stats, shares, roster spots or picks. Deleting removes all of it, refunds `
          + 'share-buying credits, and can change past results and standings. Delete anyway?')) return;
        await api.deleteAthlete(a.id, true);
      }
    });
  }

  return (
    <li>
      <details name="player">
        <summary className="row-link"><span className="who"><b>{a.name}</b>{!a.opted_in && <small>Opted out</small>}</span></summary>
        <div className="stack">
          <label>Linked account
            <select value={a.user_id ?? ''} onChange={(e) => void run(() => api.linkAthleteUser(a.id, e.target.value || null))}>
              <option value="">No linked account</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={() => void run(() => api.setAthleteOptIn(a.id, !a.opted_in))}>
            {a.opted_in ? 'Opt out' : 'Opt back in'}
          </button>
          <form className="row" onSubmit={rename}>
            <label>Name<input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <button className="secondary">Save name</button>
          </form>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="danger-link" onClick={remove}>Remove</button>
        </div>
      </details>
    </li>
  );
}
