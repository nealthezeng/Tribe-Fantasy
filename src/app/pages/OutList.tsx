import { useState, type FormEvent } from 'react';
import { AUCTION_STAGE_COLUMNS, type AuctionStage } from '../lib/auction';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { todayLocal, type CurrentSeason } from '../lib/stats';
import { supabase } from '../lib/supabase';
import { loadOpenOuts, outStage, rowsOf } from '../lib/tournament';
import { useLoad } from '../lib/useLoad';

/** Mark players Out before a tournament (spec §6): the season's playing or next stage; nothing when there is none. */
export function OutList({ season }: { season: CurrentSeason }) {
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const out = useLoad(async () => {
    const stages = await rowsOf<AuctionStage>(supabase!.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', season.id));
    const stage = outStage(stages, todayLocal());
    if (!stage) return null;
    const [athletes, outs] = await Promise.all([
      rowsOf<{ id: string; name: string; opted_in: boolean }>(supabase!.from('athletes').select('id, name, opted_in').eq('season_id', season.id).order('name')),
      loadOpenOuts(stage.id),
    ]);
    return { stage, athletes, outs };
  }, [season.id]);

  const o = out.data;
  if (!o) return out.error ? <p className="error" role="alert">{out.error}</p> : null;
  const { stage, athletes, outs } = o;
  const nameOf = new Map(athletes.map((a) => [a.id, a.name]));
  const shown = [...outs].map(([id, from]) => ({ id, from, name: nameOf.get(id) ?? 'A player' })).sort((a, b) => a.name.localeCompare(b.name));
  const free = athletes.filter((a) => a.opted_in && !outs.has(a.id));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setPick('');
      out.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }
  const mark = (e: FormEvent) => {
    e.preventDefault();
    if (pick) void run(() => api.setOut(stage.id, pick));
  };

  return (
    <div className="card">
      <h2>Out · {stage.name}</h2>
      {shown.length === 0 && <p className="muted">Nobody is out.</p>}
      <ul className="list">
        {shown.map((p) => (
          <li key={p.id}>
            <span className="title">{p.name} · from game {p.from}</span>
            <button className="secondary" disabled={busy} aria-label={`Clear ${p.name}'s Out`} onClick={() => void run(() => api.clearOut(stage.id, p.id))}>Clear</button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={mark}>
        <select aria-label="Player" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Choose a player</option>
          {free.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button disabled={busy || !pick}>Mark out</button>
      </form>
      {(error || out.error) && <p className="error" role="alert">{error ?? out.error}</p>}
    </div>
  );
}
