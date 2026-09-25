import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface StageRow { id: string; name: string; starts_on: string; ends_on: string; tournament: string | null }
const EMPTY = { id: null as string | null, name: '', starts_on: '', ends_on: '', tournament: '' };

export function StagesPanel({ seasonId }: { seasonId: string }) {
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stages = useLoad(async () => {
    const { data, error } = await supabase!
      .from('stages').select('id, name, starts_on, ends_on, tournament').eq('season_id', seasonId).order('starts_on');
    if (error) throw error;
    return (data ?? []) as StageRow[];
  }, [seasonId]);

  async function run(action: () => Promise<string | void>) {
    setStatus(null);
    setError(null);
    try {
      const done = await action();
      if (done) setStatus(done);
      stages.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const t = form.tournament.trim() || null;
      if (form.id) await api.updateStage(form.id, form.name, form.starts_on, form.ends_on, t);
      else await api.createStage(seasonId, form.name, form.starts_on, form.ends_on, t);
      setForm(EMPTY);
    });
  }

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="card">
      <h2>Stages</h2>
      <p>
        Players see stages as "seasons". Grant a stage's allowance before its auction. Running it again only
        credits teams that joined since.
      </p>
      <ul className="list">
        {stages.data?.map((s) => (
          <li key={s.id}>
            <span>{s.name} · {s.starts_on} → {s.ends_on}{s.tournament ? ` · ends at ${s.tournament}` : ''}</span>
            <span className="row">
              <button className="linklike" onClick={() => setForm({ ...s, tournament: s.tournament ?? '' })}>Edit</button>
              <button onClick={() => void run(async () => `${s.name}: credited ${await api.grantStageAllowance(s.id)} teams.`)}>
                Grant allowance
              </button>
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={save} className="row">
        <label>Name<input required value={form.name} onChange={set('name')} placeholder="Fall beta" /></label>
        <label>Starts<input type="date" required value={form.starts_on} onChange={set('starts_on')} /></label>
        <label>Ends<input type="date" required value={form.ends_on} onChange={set('ends_on')} /></label>
        <label>Ends at tournament<input value={form.tournament} onChange={set('tournament')} placeholder="optional" /></label>
        <button>{form.id ? 'Save stage' : 'Add stage'}</button>
        {form.id && <button type="button" className="secondary" onClick={() => setForm(EMPTY)}>Cancel</button>}
      </form>
      {status && <p>{status}</p>}
      {(error || stages.error) && <p className="error">{error ?? stages.error}</p>}
    </div>
  );
}
