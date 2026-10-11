import { useState, type FormEvent } from 'react';
import { Loading } from '../../components/Loading';
import { auctionPhase, formatWhen, pickPlayingStage } from '../../lib/auction';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { formatDay, todayLocal } from '../../lib/stats';
import { useLoad } from '../../lib/useLoad';
import {
  checkPairing, describePairings, GAME_COLUMNS, seasonPairings, seasonRanks, type GameRow, type GamePairing, type LeaguePairingInput,
} from '../../lib/tournament';

interface StageRow {
  id: string; name: string; starts_on: string; ends_on: string;
  bid_close_at: string | null; auction_run_at: string | null;
}
const EMPTY = { id: null as string | null, name: '', starts_on: '', ends_on: '' };

export function StagesPanel({ seasonId }: { seasonId: string }) {
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stages = useLoad(async () => {
    const { data, error } = await supabase!
      .from('stages').select('id, name, starts_on, ends_on, bid_close_at, auction_run_at').eq('season_id', seasonId).order('starts_on');
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
      if (form.id) await api.updateStage(form.id, form.name, form.starts_on, form.ends_on);
      else await api.createStage(seasonId, form.name, form.starts_on, form.ends_on);
      setForm(EMPTY);
    });
  }

  const current = pickPlayingStage(stages.data ?? [], todayLocal());
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="card">
      <h2>Tournaments</h2>
      {!stages.data && !stages.error && <Loading />}
      {/* The real order of a tournament; game 1 is paired by the standings, and keepers run games from Tally. */}
      <ol className="steps" aria-label="Each tournament, in order">
        <li>Grant allowance</li><li>Open auction</li><li>Run auction</li><li>Open tournament</li>
      </ol>
      <ul className="list">
        {stages.data?.map((s) => (
          <li key={s.id}>
            <span>
              <span className="title">{s.name}</span><br />
              <small>{formatDay(s.starts_on)} – {formatDay(s.ends_on)}</small><br />
              <small>{auctionStatus(s)}</small>
            </span>
            <span className="meta">
              <button className="secondary" onClick={() => setForm({
                id: s.id, name: s.name, starts_on: s.starts_on, ends_on: s.ends_on,
              })}>Edit</button>
              <button onClick={() => void run(async () => {
                const { ranks, unsettled } = await seasonRanks(seasonId, s.id);
                if (unsettled > 0 && !window.confirm(
                  `${unsettled} earlier ${unsettled === 1 ? 'game is' : 'games are'} not final yet, so the standings may still change. Grant anyway?`)) return;
                const n = await api.grantStageAllowance(s.id, ranks);
                return `${s.name}: credited ${n} ${n === 1 ? 'team' : 'teams'}.`;
              })}>
                Grant allowance
              </button>
            </span>
            <AuctionControls stage={s} run={run} />
            <TournamentControls stage={s} current={current?.id === s.id} seasonId={seasonId} run={run} />
          </li>
        ))}
      </ul>
      {stages.data?.length === 0 && <p className="muted">No tournaments yet. Add the first one below.</p>}
      {/* Used once a tournament: folded away, and opened by Edit. */}
      {/* Keyed by the tournament being edited, so Edit on another one reopens it even after a manual collapse. */}
      <details key={form.id ?? 'new'} className="section" open={form.id ? true : undefined}>
        <summary>{form.id ? 'Edit tournament' : 'Add a tournament'}</summary>
        <form onSubmit={save} className="row">
          <label>Name<input required maxLength={60} value={form.name} onChange={set('name')} placeholder="Fall beta" /></label>
          <label>Starts<input type="date" required value={form.starts_on} onChange={set('starts_on')} /></label>
          <label>Ends<input type="date" required value={form.ends_on} onChange={set('ends_on')} /></label>
          <button>{form.id ? 'Save tournament' : 'Add tournament'}</button>
          {form.id && <button type="button" className="secondary" onClick={() => setForm(EMPTY)}>Cancel</button>}
          {form.id && <button type="button" className="secondary" onClick={() => {
            const id = form.id!;
            if (!window.confirm(`Delete ${form.name}? Its games and their stats, rosters and bids are deleted for good. `
              + 'Credits spent in its auction go back to the teams; allowances stay, so granting an allowance again to a '
              + 're-created tournament would credit everyone twice. Take a backup first if you might want it back.')) return;
            void run(async () => {
              await api.deleteStage(id);
              setForm(EMPTY);
              return `${form.name} deleted.`;
            });
          }}>Delete tournament</button>}
        </form>
      </details>
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
      <button>{phase === 'open' ? 'Change close time' : 'Open auction'}</button>
    </form>
  );
}

interface FinishAudit { entity_id: string; details: { pairings: GamePairing[]; provisional: LeaguePairingInput[] } }

/** Open the stage's tournament once its auction has run; then staff can re-check every Swiss pairing a keeper made. */
function TournamentControls({ stage, current, seasonId, run }: {
  stage: StageRow; current: boolean; seasonId: string; run: (action: () => Promise<string | void>) => Promise<void>;
}) {
  const [checks, setChecks] = useState<{ id: string; text: string }[] | null>(null);
  const games = useLoad(async () => {
    const { data, error } = await supabase!.from('games').select(GAME_COLUMNS).eq('stage_id', stage.id).order('number');
    if (error) throw error;
    return (data ?? []) as GameRow[];
  }, [stage.id]);
  if (!stage.auction_run_at) return null;
  if (games.error) return <p className="error" role="alert">{games.error}</p>;
  if (!games.data) return null;

  if (games.data.length === 0) {
    if (!current) return null;
    return (
      <div className="row">
        <button onClick={() => void run(async () => {
          const p = await seasonPairings(seasonId);
          if (!window.confirm(`Open the ${stage.name} tournament? Game 1: ${describePairings(p.pairings, p.team)}.`)) return;
          await api.openTournament(stage.id, p.pairings);
          games.reload();
          return `${stage.name}: game 1 is paired. Keepers start it on the Tally tab.`;
        })}>Open tournament</button>
      </div>
    );
  }

  const last = games.data[games.data.length - 1];
  // Undo = reset the newest started game (spec §3): its stats and the next game it created go; it can be replayed.
  // A past tournament has no Start game, so there is nothing to replay: Undo only on the one that can still be played.
  const played = current ? games.data.filter((g) => g.started_at !== null).at(-1) : undefined;
  const undo = (g: GameRow) => {
    if (!window.confirm(`Undo game ${g.number} of ${stage.name}? Its stats are deleted, the game after it is unpaired, `
      + `and game ${g.number} can be started again. Take a backup first if you might want it back.`)) return;
    void run(async () => {
      await api.resetGame(g.id);
      games.reload();
      return `${stage.name}: game ${g.number} undone. Keepers can start it again on the Tally tab.`;
    });
  };
  const number = new Map(games.data.map((g) => [g.id, g.number]));
  const check = () => void run(async () => {
    const { data, error } = await supabase!.from('audit_log').select('entity_id, details')
      .eq('action', 'finish_game').in('entity_id', games.data!.map((g) => g.id)).order('at');
    if (error) throw error;
    // An undo + replay finishes a game twice: keep only the latest row per game (oldest first, so later ones overwrite).
    const latest = [...new Map(((data ?? []) as FinishAudit[]).map((r) => [r.entity_id, r])).values()]
      .sort((a, b) => number.get(a.entity_id)! - number.get(b.entity_id)!);
    setChecks(latest.map((r) => ({ id: r.entity_id, text: `Game ${number.get(r.entity_id)! + 1}: ${checkPairing(r.details)
      ? 'matches a Swiss re-run of the standings it was made from.'
      : "doesn't match a Swiss re-run. Look at this finish_game row in the audit log."}` })));
  });
  return (
    <details className="section">
      <summary>Tournament <span className="muted">· game {last.number} {last.started_at ? 'live' : 'next'}</span></summary>
      <div className="stack">
        <div className="row">
          <button className="secondary" onClick={check}>Check pairings</button>
          {played && <button className="secondary" onClick={() => undo(played)}>Undo game {played.number}</button>}
        </div>
        {checks && (
          <ul className="list">
            {checks.length === 0 && <li className="muted">No game has finished yet.</li>}
            {checks.map((c) => <li key={c.id}>{c.text}</li>)}
          </ul>
        )}
      </div>
    </details>
  );
}
