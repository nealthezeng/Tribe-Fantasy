import { Fragment, useState, type FormEvent, type ReactNode } from 'react';
import { Loading } from '../../components/Loading';
import { OpponentsForm } from '../../components/OpponentsForm';
import { auctionPhase, formatWhen, pickPlayingStage } from '../../lib/auction';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { formatDay, todayLocal } from '../../lib/stats';
import { useLoad } from '../../lib/useLoad';
import {
  checkPairing, describePairings, GAME_COLUMNS, rowsOf, seasonPairings, seasonRanks, type GameRow, type GamePairing, type LeaguePairingInput,
} from '../../lib/tournament';

interface StageRow {
  id: string; name: string; starts_on: string; ends_on: string;
  bid_close_at: string | null; auction_run_at: string | null;
}
/** Runs an admin action, then reloads; its message shows in the tournament it was made in (`at`; null = under the list). */
type Run = (at: string | null, action: () => Promise<string | void>) => void;
type Step = 'credits' | 'buying' | 'settle' | 'start';
const EMPTY = { name: '', starts_on: '', ends_on: '' };
type Fields = typeof EMPTY;
const days = (s: StageRow) => (s.starts_on === s.ends_on ? formatDay(s.starts_on) : `${formatDay(s.starts_on)} – ${formatDay(s.ends_on)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * P9 admin Tournaments: the tournament in progress is a card with its steps in one line and the one gold button due
 * now; later and earlier tournaments are one row each that opens to the same steps (never gold) and rows.
 */
export function StagesPanel({ seasonId }: { seasonId: string }) {
  const [note, setNote] = useState<{ at: string | null; text: string; bad?: boolean } | null>(null);
  // Everything at once, so a row never opens onto an empty box while its games load.
  const data = useLoad(async () => {
    const sb = supabase!;
    const stages = (await rowsOf<StageRow>(sb.from('stages').select('id, name, starts_on, ends_on, bid_close_at, auction_run_at').eq('season_id', seasonId)))
      .sort((a, b) => b.starts_on.localeCompare(a.starts_on)); // newest first
    const ids = stages.map((s) => s.id);
    const [games, granted] = await Promise.all([
      rowsOf<GameRow>(ids.length ? sb.from('games').select(GAME_COLUMNS).in('stage_id', ids).order('number') : null),
      rowsOf<{ stage_id: string }>(ids.length ? sb.from('credit_ledger').select('stage_id').in('stage_id', ids).eq('kind', 'allowance') : null),
    ]);
    return { stages, games, granted: new Set(granted.map((r) => r.stage_id)) };
  }, [seasonId]);

  const run: Run = (at, action) => {
    setNote(null);
    void action().then(
      (text) => { if (text) setNote({ at, text }); void data.reload(); },
      (err: unknown) => setNote({ at, text: errorMessage(err), bad: true }),
    );
  };
  const noteAt = (at: string | null) => note?.at === at
    && <p className={note.bad ? 'error' : 'success'} role={note.bad ? 'alert' : 'status'}>{note.text}</p>;

  if (!data.data) return data.error ? <p className="error" role="alert">{data.error}</p> : <Loading />;
  const { stages, games, granted } = data.data;
  const today = todayLocal();
  const playing = pickPlayingStage(stages, today)?.id;
  const of = (s: StageRow) => games.filter((g) => g.stage_id === s.id);
  // Over: its last day has passed, or every game it has is finished. The earliest one not over is in progress.
  const over = (s: StageRow) => s.ends_on < today || (of(s).length > 0 && of(s).every((g) => g.finished_at !== null));
  const current = stages.filter((s) => !over(s)).at(-1);
  const body = (s: StageRow, gold: boolean) => (
    <Tournament s={s} games={of(s)} granted={granted.has(s.id)} playing={s.id === playing} gold={gold} seasonId={seasonId} run={run}
      note={noteAt(s.id)} />
  );
  const rows = (list: StageRow[]) => (
    <ul className="list">
      {list.map((s) => {
        const live = of(s).find((g) => g.started_at !== null && g.finished_at === null);
        return (
          <li key={s.id}>
            <details>
              <summary className="row-link">
                <span className="who"><b>{s.name}</b><small>{days(s)}</small></span>
                {over(s) && (live ? <span className="pill warn">Game {live.number} live</span> : <span className="muted">Finished</span>)}
              </summary>
              {body(s, false)}
            </details>
          </li>
        );
      })}
    </ul>
  );
  const later = stages.filter((s) => s !== current && !over(s));
  const earlier = stages.filter(over);
  return (
    <>
      {current && (
        // Keyed: when the next tournament takes the card, its fields start empty, not with the last one's typing.
        <article key={current.id} className="card">
          <div className="head"><h2>{current.name}</h2><span className="muted">{days(current)}</span></div>
          {body(current, true)}
        </article>
      )}
      {later.length > 0 && <><h2>Later</h2>{rows(later)}</>}
      {earlier.length > 0 && <><h2>Earlier</h2>{rows(earlier)}</>}
      <AddTournament seasonId={seasonId} run={run} cls={current ? 'secondary' : undefined} first={stages.length === 0} />
      {noteAt(null)}
      {data.error && <p className="error" role="alert">{data.error}</p>}
    </>
  );
}

/** One tournament: its steps in one line, the action due now (gold only on the card, P9 rule 2), then its rows. */
function Tournament({ s, games, granted, playing, gold, seasonId, run, note }: {
  s: StageRow; games: GameRow[]; granted: boolean; playing: boolean; gold: boolean; seasonId: string; run: Run; note: ReactNode;
}) {
  const phase = auctionPhase(s);
  const now = games.find((g) => g.finished_at === null); // the current game; none = every game is finished
  const when = s.bid_close_at ? formatWhen(s.bid_close_at) : '';
  // The step at hand: the allowance while shares aren't settled, then buying, settling, starting.
  const at: Step = phase !== 'run' && !granted ? 'credits' : phase === 'closed' ? 'settle' : phase === 'run' ? 'start' : 'buying';
  const steps: [Step, string][] = [
    ['credits', granted ? 'Allowance given' : 'Allowance'],
    ...(phase === 'run' ? [] : [['buying', { not_open: 'Buying', open: `Buying open, closes ${when}`, closed: `Buying closed ${when}` }[phase]] as [Step, string]]),
    ['settle', phase === 'run' ? 'Shares settled' : 'Settle'],
    ['start', now ? `Game ${now.number} of ${games.length} ${now.started_at ? 'live' : 'next'}` : games.length ? `Finished after game ${games.length}` : 'Start'],
  ];
  const cls = (step: Step) => (gold && step === at ? undefined : 'secondary');

  const grant = () => run(s.id, async () => {
    const { ranks, unsettled } = await seasonRanks(seasonId, s.id);
    if (unsettled > 0 && !window.confirm(
      `${unsettled} earlier ${unsettled === 1 ? 'game is' : 'games are'} not final yet, so the standings may still change. Grant anyway?`)) return;
    const n = await api.grantStageAllowance(s.id, ranks);
    return `${s.name}: credited ${plural(n, 'team')}.`;
  });
  const closeNow = () => {
    if (!window.confirm(`Close buying for ${s.name} now? Teams can't buy or change shares after this, and it can't be reopened.`)) return;
    run(s.id, async () => { await api.closeShareBuying(s.id); return `${s.name}: share buying closed.`; });
  };
  const settle = () => {
    if (!window.confirm(`Settle ${s.name} shares? Every team gets its players now. This runs once; you can still fix a team's shares by hand.`)) return;
    run(s.id, async () => {
      const r = await api.runAuction(s.id);
      return `${s.name} shares settled: every team has its players (${plural(r.by_bid, 'buy')}).`;
    });
  };
  return (
    <div className="stack">
      <p className="steps">
        {steps.map(([k, w], i) => (
          <Fragment key={k}>{i > 0 && ' · '}{k === at ? <span className="now" aria-current="step">{w}</span> : <span>{w}</span>}</Fragment>
        ))}
      </p>
      {!granted && <button className={cls('credits')} onClick={grant}>Grant allowance</button>}
      {phase === 'open' && <button className={cls('buying')} onClick={closeNow}>Close buying now</button>}
      {(phase === 'not_open' || phase === 'open') && <CloseTime s={s} cls={phase === 'open' ? 'secondary' : cls('buying')} run={run} />}
      {phase === 'closed' && <button className={cls('settle')} onClick={settle}>Settle shares</button>}
      {/* Game 1 is paired by the standings, and keepers run games from Tally. */}
      {phase === 'run' && games.length === 0 && playing && <OpenTournament s={s} cls={cls('start')} seasonId={seasonId} run={run} />}
      {note}
      <ul className="list">
        {games.length > 0 && <GamesRow s={s} games={games} playing={playing} seasonId={seasonId} run={run} />}
        {games.length > 0 && <PairingsRow s={s} games={games} run={run} />}
        <NameRow s={s} run={run} />
      </ul>
    </div>
  );
}

/** Open share buying with its closing time, or move that time while open. A past time is refused before any confirm. */
function CloseTime({ s, cls, run }: { s: StageRow; cls: string | undefined; run: Run }) {
  const [closeAt, setCloseAt] = useState('');
  const open = auctionPhase(s) === 'open';
  return (
    <form className="row" onSubmit={(e) => {
      e.preventDefault();
      const close = new Date(closeAt);
      if (close.getTime() <= Date.now()) return run(s.id, () => Promise.reject(new Error('INVALID_CLOSE_TIME')));
      const closeIso = close.toISOString();
      if (!window.confirm(open ? `Move the ${s.name} close time to ${formatWhen(closeIso)}?`
        : `Open share buying for ${s.name}? It closes ${formatWhen(closeIso)}. It can't be cancelled.`)) return;
      run(s.id, async () => {
        await api.openAuction(s.id, closeIso);
        setCloseAt('');
        return `${s.name}: share buying closes ${formatWhen(closeIso)}.`;
      });
    }}>
      <label>Buying closes<input type="datetime-local" required value={closeAt} onChange={(e) => setCloseAt(e.target.value)} /></label>
      <button className={cls}>{open ? 'Change close time' : 'Open share buying'}</button>
    </form>
  );
}

/** Opens the settled tournament with its game count. Never disabled: the required field stops an empty one. */
function OpenTournament({ s, cls, seasonId, run }: { s: StageRow; cls: string | undefined; seasonId: string; run: Run }) {
  const [count, setCount] = useState('');
  return (
    <form className="row" onSubmit={(e) => {
      e.preventDefault();
      run(s.id, async () => {
        const p = await seasonPairings(seasonId);
        if (!window.confirm(`Open the ${s.name} tournament with ${count} ${count === '1' ? 'game' : 'games'}? Game 1: ${describePairings(p.pairings, p.team)}.`)) return;
        await api.openTournament(s.id, p.pairings, Number(count));
        return `${s.name}: game 1 is paired. Set opponents under Games and count; keepers start it from Stats → Tally.`;
      });
    }}>
      <label>Games<input type="number" required min={1} max={20} value={count} onChange={(e) => setCount(e.target.value)} /></label>
      <button className={cls}>Open tournament</button>
    </form>
  );
}

/** The game count (on the tournament being played), every game's opponent, and Undo game last. */
function GamesRow({ s, games, playing, seasonId, run }: { s: StageRow; games: GameRow[]; playing: boolean; seasonId: string; run: Run }) {
  const [count, setCount] = useState<string | null>(null); // the Games field: an edit of the current count (null = untouched)
  const total = games.length;
  const now = games.find((g) => g.finished_at === null);
  const minCount = Math.max(1, ...games.filter((g) => g.started_at !== null).map((g) => g.number));
  const unset = games.filter((g) => !g.opponent).length;
  // Raising a finished tournament pairs the new game now (spec §5.9), so show those pairings first; anything else needs no confirm.
  const saveCount = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(count ?? total);
    run(s.id, async () => {
      if (n === total) return;
      if (n > total && !now) {
        const p = await seasonPairings(seasonId);
        if (!window.confirm(`Raise ${s.name} to ${n} games? Game ${total + 1}: ${describePairings(p.pairings, p.team)}.`)) return;
        await api.setGameCount(s.id, n, p.pairings, p.provisional);
      } else await api.setGameCount(s.id, n);
      setCount(null);
      return `${s.name}: ${plural(n, 'game')}.`;
    });
  };
  // Undo = reset the newest started game (spec §3): its stats and the next game it created go; it can be replayed.
  // A past tournament has no Start game, so there is nothing to replay: Undo only on the one that can still be played.
  const played = playing ? games.filter((g) => g.started_at !== null).at(-1) : undefined;
  const undo = (g: GameRow) => {
    if (!window.confirm(`Undo game ${g.number} of ${s.name}? Its stats are deleted, the game after it is unpaired, `
      + `and game ${g.number} can be started again. Take a backup first if you might want it back.`)) return;
    run(s.id, async () => {
      await api.resetGame(g.id);
      return `${s.name}: game ${g.number} undone. Keepers can start it again from Stats → Tally.`;
    });
  };
  return (
    <li>
      <details>
        <summary className="row-link">
          <span className="who"><b>Games and count</b><small>{`${plural(total, 'game')}${unset > 0 ? ` · ${plural(unset, 'opponent')} not set` : ''}`}</small></span>
        </summary>
        <div className="stack">
          {playing && (
            <form className="row" onSubmit={saveCount}>
              <label>Games<input type="number" required min={minCount} max={20} value={count ?? String(total)} onChange={(e) => setCount(e.target.value)} /></label>
              <button className="secondary">Save count</button>
            </form>
          )}
          {/* The Tally hub's form too (X12); run reloads after any action, so "{n} opponents not set" updates. */}
          <OpponentsForm games={games} onSaved={() => run(s.id, async () => {})} />
          {played && <button className="danger-link" onClick={() => undo(played)}>Undo game {played.number}</button>}
        </div>
      </details>
    </li>
  );
}

interface FinishAudit { entity_id: string; details: { pairings: GamePairing[]; provisional: LeaguePairingInput[] } }

/** Re-checks every Swiss pairing a keeper's Finish made, against the standings it was made from. */
function PairingsRow({ s, games, run }: { s: StageRow; games: GameRow[]; run: Run }) {
  const [checks, setChecks] = useState<{ id: string; text: string }[] | null>(null);
  const number = new Map(games.map((g) => [g.id, g.number]));
  const check = () => run(s.id, async () => {
    const { data, error } = await supabase!.from('audit_log').select('entity_id, details')
      .eq('action', 'finish_game').in('entity_id', games.map((g) => g.id)).order('at');
    if (error) throw error;
    // An undo + replay finishes a game twice: keep only the latest row per game (oldest first, so later ones overwrite).
    // The last game's finish pairs nothing (saved as null, not typed): nothing to re-check, so skip those rows.
    const latest = [...new Map(((data ?? []) as FinishAudit[]).filter((r) => Array.isArray(r.details.pairings)).map((r) => [r.entity_id, r])).values()]
      .sort((a, b) => number.get(a.entity_id)! - number.get(b.entity_id)!);
    setChecks(latest.map((r) => ({ id: r.entity_id, text: `Game ${number.get(r.entity_id)! + 1}: ${checkPairing(r.details)
      ? 'matches a Swiss re-run of the standings it was made from.'
      : "doesn't match a Swiss re-run. Look at this finish_game row in the audit log."}` })));
  });
  return (
    <li>
      <details>
        <summary className="row-link"><span className="who"><b>Pairings</b></span></summary>
        <div className="stack">
          <button className="secondary" onClick={check}>Check pairings</button>
          {checks && (
            <ul className="list">
              {checks.length === 0 && <li className="muted">No game has finished yet.</li>}
              {checks.map((c) => <li key={c.id}>{c.text}</li>)}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}

/** Name and dates, edited in place; Delete tournament last, in red words, its confirm word for word. */
function NameRow({ s, run }: { s: StageRow; run: Run }) {
  const [f, setF] = useState<Fields>({ name: s.name, starts_on: s.starts_on, ends_on: s.ends_on });
  const del = () => {
    if (!window.confirm(`Delete ${s.name}? Its games and their stats, rosters and shares are deleted for good. `
      + 'Credits spent on its shares go back to the teams; allowances stay, so granting an allowance again to a '
      + 're-created tournament would credit everyone twice. Take a backup first if you might want it back.')) return;
    run(null, async () => { await api.deleteStage(s.id); return `${s.name} deleted.`; });
  };
  return (
    <li>
      <details>
        <summary className="row-link"><span className="who"><b>Name and dates</b></span></summary>
        <div className="stack">
          <form className="row" onSubmit={(e) => {
            e.preventDefault();
            run(s.id, async () => { await api.updateStage(s.id, f.name, f.starts_on, f.ends_on); return 'Saved.'; });
          }}>
            <StageFields f={f} setF={setF} />
            <button className="secondary">Save tournament</button>
          </form>
          <button className="danger-link" onClick={del}>Delete tournament</button>
        </div>
      </details>
    </li>
  );
}

/** Used once a tournament: folded away, open while the season has none; gold only when no tournament is in progress. */
function AddTournament({ seasonId, run, cls, first }: { seasonId: string; run: Run; cls: string | undefined; first: boolean }) {
  const [f, setF] = useState(EMPTY);
  return (
    <details className="section" open={first || undefined}>
      <summary>Add a tournament</summary>
      <form className="row" onSubmit={(e) => {
        e.preventDefault();
        run(null, async () => { await api.createStage(seasonId, f.name, f.starts_on, f.ends_on); setF(EMPTY); });
      }}>
        <StageFields f={f} setF={setF} />
        <button className={cls}>Add tournament</button>
      </form>
    </details>
  );
}

function StageFields({ f, setF }: { f: Fields; setF: (f: Fields) => void }) {
  const set = (key: keyof Fields) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });
  return (
    <>
      <label>Name<input required maxLength={60} value={f.name} onChange={set('name')} placeholder="Fall beta" /></label>
      <label>Starts<input type="date" required value={f.starts_on} onChange={set('starts_on')} /></label>
      <label>Ends<input type="date" required value={f.ends_on} onChange={set('ends_on')} /></label>
    </>
  );
}
