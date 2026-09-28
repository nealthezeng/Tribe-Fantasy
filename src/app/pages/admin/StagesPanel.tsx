import { useState, type FormEvent } from 'react';
import { auctionPhase, formatWhen } from '../../lib/auction';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { formatDay } from '../../lib/stats';
import { useLoad } from '../../lib/useLoad';
import { seasonRanks, WEEK_COLUMNS, type WeekRow } from '../../lib/weekly';

interface StageRow {
  id: string; name: string; starts_on: string; ends_on: string; tournament: string | null;
  bid_close_at: string | null; auction_run_at: string | null;
}
const EMPTY = { id: null as string | null, name: '', starts_on: '', ends_on: '', tournament: '' };

export function StagesPanel({ seasonId }: { seasonId: string }) {
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stages = useLoad(async () => {
    const { data, error } = await supabase!
      .from('stages').select('id, name, starts_on, ends_on, tournament, bid_close_at, auction_run_at').eq('season_id', seasonId).order('starts_on');
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
      {!stages.data && !stages.error && <p className="muted" role="status">Loading…</p>}
      <p className="muted">
        Players see stages as "seasons". Grant a stage's allowance before its auction: it pays by the current
        standings, and running it again only credits teams that joined since. Then open the auction with a closing
        time, run it once bids close, and create the stage's weeks. Weeks run Monday to Sunday; picks lock at the
        season's pick_lock_day and pick_lock_time (Eastern). After changing a stage's dates, rebuild its weeks.
      </p>
      <ul className="list">
        {stages.data?.map((s) => (
          <li key={s.id}>
            <span>
              <span className="title">{s.name}</span><br />
              <small>{formatDay(s.starts_on)} – {formatDay(s.ends_on)}{s.tournament ? ` · ends at ${s.tournament}` : ''}</small><br />
              <small>{auctionStatus(s)}</small>
            </span>
            <span className="meta">
              <button className="secondary" onClick={() => setForm({
                id: s.id, name: s.name, starts_on: s.starts_on, ends_on: s.ends_on, tournament: s.tournament ?? '',
              })}>Edit</button>
              <button onClick={() => void run(async () => {
                const { ranks, unsettled } = await seasonRanks(seasonId, s.starts_on);
                if (unsettled > 0 && !window.confirm(
                  `${unsettled} earlier ${unsettled === 1 ? 'week is' : 'weeks are'} not final yet, so the standings may still change. Grant anyway?`)) return;
                const n = await api.grantStageAllowance(s.id, ranks);
                return `${s.name}: credited ${n} teams.`;
              })}>
                Grant allowance
              </button>
            </span>
            <AuctionControls stage={s} run={run} />
            <WeeksControls stage={s} run={run} />
          </li>
        ))}
      </ul>
      {stages.data?.length === 0 && <p className="muted">No stages yet. Add the first one below.</p>}
      <form onSubmit={save} className="row section">
        <label>Name<input required maxLength={60} value={form.name} onChange={set('name')} placeholder="Fall beta" /></label>
        <label>Starts<input type="date" required value={form.starts_on} onChange={set('starts_on')} /></label>
        <label>Ends<input type="date" required value={form.ends_on} onChange={set('ends_on')} /></label>
        <label>Ends at tournament<input maxLength={60} value={form.tournament} onChange={set('tournament')} placeholder="optional" /></label>
        <button>{form.id ? 'Save stage' : 'Add stage'}</button>
        {form.id && <button type="button" className="secondary" onClick={() => setForm(EMPTY)}>Cancel</button>}
      </form>
      {status && <p className="success" role="status">{status}</p>}
      {(error || stages.error) && <p className="error" role="alert">{error ?? stages.error}</p>}
    </div>
  );
}

function auctionStatus(s: StageRow): string {
  switch (auctionPhase(s)) {
    case 'not_open': return 'Auction not open';
    case 'open': return `Bidding open · closes ${formatWhen(s.bid_close_at!)}`;
    case 'closed': return `Bids closed ${formatWhen(s.bid_close_at!)} · ready to run`;
    case 'run': return `Auction ran ${formatWhen(s.auction_run_at!)}`;
  }
}

function AuctionControls({ stage, run }: { stage: StageRow; run: (action: () => Promise<string | void>) => Promise<void> }) {
  const [closeAt, setCloseAt] = useState('');
  const phase = auctionPhase(stage);
  if (phase === 'run') return null;
  if (phase === 'closed') {
    return (
      <div className="row">
        <button onClick={() => {
          if (!window.confirm(`Run the ${stage.name} auction? It can only run once.`)) return;
          void run(async () => {
            const r = await api.runAuction(stage.id);
            return `${stage.name}: awarded ${r.by_bid} by bid, ${r.by_fill} by random fill, ${r.empty} spots left empty.`;
          });
        }}>Run auction</button>
      </div>
    );
  }
  return (
    <form className="row" onSubmit={(e) => {
      e.preventDefault();
      const closeIso = new Date(closeAt).toISOString();
      const prompt = phase === 'open'
        ? `Move the ${stage.name} close time to ${formatWhen(closeIso)}?`
        : `Open the ${stage.name} auction? Bids close ${formatWhen(closeIso)}. It can't be cancelled.`;
      if (!window.confirm(prompt)) return;
      void run(async () => {
        await api.openAuction(stage.id, closeIso);
        setCloseAt('');
        return `${stage.name}: bidding closes ${formatWhen(closeIso)}.`;
      });
    }}>
      <label>Bids close<input type="datetime-local" required value={closeAt} onChange={(e) => setCloseAt(e.target.value)} /></label>
      <button>{phase === 'open' ? 'Move close time' : 'Open auction'}</button>
    </form>
  );
}

function WeeksControls({ stage, run }: { stage: StageRow; run: (action: () => Promise<string | void>) => Promise<void> }) {
  const weeks = useLoad(async () => {
    const { data, error } = await supabase!.from('weeks').select(WEEK_COLUMNS).eq('stage_id', stage.id).order('starts_on');
    if (error) throw error;
    return (data ?? []) as WeekRow[];
  }, [stage.id]);
  const act = (action: () => Promise<string | void>) => run(async () => {
    const done = await action();
    weeks.reload();
    return done;
  });
  const n = weeks.data?.length ?? 0;
  return (
    <details className="section">
      <summary>Weeks {weeks.data && <span className="muted">· {n === 0 ? 'none yet' : n}</span>}</summary>
      <div className="stack">
        <button className={n === 0 ? '' : 'secondary'} onClick={() => {
          if (n > 0 && !window.confirm(`Rebuild the ${stage.name} weeks from its dates? Custom lock times are lost.`)) return;
          void act(async () => `${stage.name}: ${await api.createStageWeeks(stage.id)} weeks.`);
        }}>{n === 0 ? 'Create weeks' : 'Rebuild weeks'}</button>
        <ul className="list">
          {weeks.data?.map((w) => <WeekLock key={`${w.id}:${w.pick_lock_at}`} week={w} act={act} />)}
        </ul>
        {weeks.error && <p className="error" role="alert">{weeks.error}</p>}
      </div>
    </details>
  );
}

/** datetime-local works in the admin's own time zone. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function WeekLock({ week, act }: { week: WeekRow; act: (action: () => Promise<string | void>) => Promise<void> }) {
  const [value, setValue] = useState(toLocalInput(week.pick_lock_at));
  return (
    <li>
      <span>
        <span className="title">{formatDay(week.starts_on)} – {formatDay(week.ends_on)}</span><br />
        <small>Picks lock {formatWhen(week.pick_lock_at)}</small>
      </span>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        const at = new Date(value).toISOString();
        void act(async () => {
          await api.setWeekLock(week.id, at);
          return `Week of ${formatDay(week.starts_on)}: picks lock ${formatWhen(at)}.`;
        });
      }}>
        <label>Lock (your time)<input type="datetime-local" required value={value} onChange={(e) => setValue(e.target.value)} /></label>
        <button className="secondary" disabled={value === toLocalInput(week.pick_lock_at)}>Save lock</button>
      </form>
    </li>
  );
}
