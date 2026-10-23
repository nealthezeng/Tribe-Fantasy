import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { mergeTaps } from '../../core/taps';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../components/Loading';
import { loadOwnedAthletes } from '../lib/auction';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import {
  gameTitles, loadCurrentSeason, SESSION_COLUMNS, sessionState, sessionTitle, statLabel,
  type CurrentSeason, type SessionRow,
} from '../lib/stats';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { loadCurrentGame, loadOpenOuts, loadStarters } from '../lib/tournament';
import { GameControls } from './GameControls';
import { OutList } from './OutList';
import {
  BATCH_MAX, canForgetLocally, errorCode, isRejection, lastUndoable, loadQueue, notFoundDrop, queuedSessions, queuedToTap, removeSent,
  rowToTap, storeQueue, subtractHint, unsavedTaps,
  type QueuedTap, type StatTapRow,
} from '../tally/queue';

export function TallyPage() {
  const { session, isKeeper, loading } = useAuth();
  const [params, setParams] = useSearchParams(); // ?game= deep-links straight to a board
  const sessionId = params.get('game');
  const season = useLoad(loadCurrentSeason, []);
  if (loading) return <Loading />;
  if (!session || !isKeeper) return <Navigate to="/" replace />;
  if (season.error) return <p className="error" role="alert">{season.error}</p>;
  if (season.data === null) return <p>No season yet.</p>;
  if (!season.data) return <Loading />;
  return sessionId ? (
    <TallyBoard key={sessionId} season={season.data} sessionId={sessionId} keeperId={session.user.id} onBack={() => setParams({})} />
  ) : (
    <SessionPicker season={season.data} keeperId={session.user.id} onPick={(id) => setParams({ game: id })} />
  );
}

function SessionPicker({ season, keeperId, onPick }: {
  season: CurrentSeason; keeperId: string; onPick: (id: string) => void;
}) {
  // Taps still on this phone, so they're never stranded: their sessions are listed even once verified.
  const [unsaved] = useState(() => new Map(queuedSessions(keeperId).map((q) => [q.sessionId, q.count])));
  // Tournament games only (T4): practice tallying is retired. A non-game session shows up only to drain this phone's taps.
  // The current tournament's games (unsaved taps too) are rows on GameControls' card: this card holds everything else.
  const sessions = useLoad(async () => {
    const open = `and(season_id.eq.${season.id},verified_at.is.null)`;
    const { data, error } = await supabase!.from('sessions').select(SESSION_COLUMNS)
      .or(unsaved.size ? `${open},id.in.(${[...unsaved.keys()].join(',')})` : open)
      .order('held_on', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as SessionRow[];
    const [game, current] = await Promise.all([gameTitles(rows.map((s) => s.id)), loadCurrentGame(season.id)]);
    const hub = new Set(current?.games.map((g) => g.session_id));
    return rows.filter((s) => !hub.has(s.id) && (game.has(s.id) || unsaved.has(s.id))).map((s) => ({ ...s, game: game.get(s.id) ?? null }));
  }, [season.id, unsaved]);

  return (
    <section className="page">
      <h1>Tally</h1>
      <GameControls season={season} onOpen={onPick} unsaved={unsaved} />
      <OutList season={season} />
      {(sessions.error || !!sessions.data?.length) && (
        <div className="card">
          <h2>Open games</h2>
          <ul className="list">
            {sessions.data?.map((s) => (
              <li key={s.id}>
                <Link className="row-link" to={`/tally?game=${s.id}`}>
                  <span className="who"><b>{s.game ?? sessionTitle(s)}</b></span>
                  {unsaved.has(s.id) && <span className="pill warn">{unsaved.get(s.id)} unsaved</span>}
                </Link>
              </li>
            ))}
          </ul>
          {sessions.error && <p className="error" role="alert">{sessions.error}</p>}
        </div>
      )}
    </section>
  );
}

interface AthleteRow { id: string; name: string }

const BRIGHT_KEY = 'tribe.tally.bright';
/** The longest the board's first load waits for the picked group; field signal is weak and keepers tap at once. */
export const STARTERS_WAIT_MS = 1500;

function TallyBoard({ season, sessionId, keeperId, onBack }: {
  season: CurrentSeason; sessionId: string; keeperId: string; onBack: () => void;
}) {
  const { isAdmin } = useAuth();
  const [queue, setQueue] = useState<QueuedTap[]>(() => loadQueue(keeperId, sessionId));
  // Saved batches until the reload shows them, so counts and hold-to-subtract don't skip them meanwhile.
  const [sent, setSent] = useState<QueuedTap[]>([]);
  const [stored, setStored] = useState(true);
  const [rejected, setRejected] = useState<{ count: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [search, setSearch] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  // t330: bright by default for daylight; '0' in storage is a keeper's choice to turn it off on this device.
  const [bright, setBright] = useState(() => {
    try { return localStorage.getItem(BRIGHT_KEY) !== '0'; } catch { return true; }
  });
  useEffect(() => { // only the board itself is bright: leaving it, by any way, restores the app's own theme
    if (!bright) return;
    document.documentElement.dataset.tally = 'bright';
    return () => { delete document.documentElement.dataset.tally; };
  }, [bright]);
  const queueRef = useRef(queue);
  // Settled once, with the board's first load: starters don't change once a game starts, and a list that regroups
  // under a keeper's thumb mis-taps. Null when they fail or miss STARTERS_WAIT_MS: one A→Z list for this visit (ruling 15).
  const starters = useRef<Promise<Set<string> | null>>(undefined);
  const sending = useRef(false);
  const inFlight = useRef<Set<string>>(new Set());

  const data = useLoad(async () => {
    const sess = await supabase!.from('sessions').select(SESSION_COLUMNS).eq('id', sessionId).single();
    if (sess.error) throw sess.error;
    // The session's own season: a queued session from an earlier season must show that season's athletes.
    const seasonId = (sess.data as SessionRow).season_id;
    // The board's tournament game (none for a non-game session): Out marks belong to its stage.
    const game = await supabase!.from('games').select('stage_id, number').eq('session_id', sessionId).maybeSingle();
    if (game.error) throw game.error;
    starters.current ??= game.data ? Promise.race([
      loadStarters(seasonId, game.data.stage_id, game.data.number).catch(() => null),
      new Promise<null>((late) => setTimeout(() => late(null), STARTERS_WAIT_MS)),
    ]) : Promise.resolve(null);
    const [athletes, taps, outs, started, owned, titles, picked] = await Promise.all([
      supabase!.from('athletes').select('id, name').eq('season_id', seasonId).eq('opted_in', true).order('name'),
      supabase!.from('stat_taps').select('id, athlete_id, stat, keeper_id, tapped_at, undoes').eq('session_id', sessionId),
      game.data ? loadOpenOuts(game.data.stage_id as string) : new Map<string, number>(),
      // "Out from game N" reads only while game N hasn't started, whichever game's board this is.
      game.data ? supabase!.from('games').select('number').eq('stage_id', game.data.stage_id).not('started_at', 'is', null) : { data: [], error: null },
      // The server refuses a keeper's taps on their own players (OWNS_ATHLETE); admins may tally anyone (t120).
      isAdmin ? new Set<string>() : loadOwnedAthletes(keeperId, seasonId).catch(() => new Set<string>()),
      gameTitles([sessionId]),
      starters.current,
    ]);
    for (const r of [athletes, taps, started]) if (r.error) throw r.error;
    return {
      session: sess.data as SessionRow,
      athletes: (athletes.data ?? []) as AthleteRow[],
      taps: (taps.data ?? []) as StatTapRow[],
      game: game.data as { stage_id: string; number: number } | null,
      outs,
      lastStarted: Math.max(0, ...((started.data ?? []) as { number: number }[]).map((g) => g.number)),
      owned,
      title: titles.get(sessionId) ?? sessionTitle(sess.data as SessionRow),
      picked,
    };
  }, [sessionId, keeperId, isAdmin]);
  const reload = data.reload;

  useEffect(() => {
    queueRef.current = queue;
    setStored(storeQueue(keeperId, sessionId, queue));
  }, [queue, keeperId, sessionId]);

  const flush = useCallback(async () => {
    const batch = queueRef.current.slice(0, BATCH_MAX);
    if (sending.current || batch.length === 0) return;
    sending.current = true;
    inFlight.current = new Set(batch.map((t) => t.id));
    try {
      await api.saveTaps(sessionId, new Date().toISOString(), batch);
      // Straight to storage too: after the board unmounts, the state update below goes nowhere.
      storeQueue(keeperId, sessionId, removeSent(loadQueue(keeperId, sessionId), batch));
      setQueue((q) => removeSent(q, batch));
      setSent((s) => [...s, ...batch]);
      reload();
    } catch (err) {
      if (isRejection(err)) {
        let drop = batch;
        let message = errorMessage(err);
        if (errorCode(err) === 'NOT_FOUND') {
          const ids = [...new Set(batch.map((t) => t.athlete_id))];
          const [sess, found] = await Promise.all([
            supabase!.from('sessions').select('id').eq('id', sessionId),
            supabase!.from('athletes').select('id').in('id', ids),
          ]);
          if (sess.error || found.error) return; // can't tell what's gone yet: keep the taps and retry
          const why = notFoundDrop(batch, (sess.data ?? []).length > 0, new Set((found.data ?? []).map((a) => a.id as string)));
          drop = why.drop;
          message = why.message ?? message;
        }
        storeQueue(keeperId, sessionId, removeSent(loadQueue(keeperId, sessionId), drop));
        setQueue((q) => removeSent(q, drop));
        // A different reason replaces the banner rather than adding to a count it doesn't explain.
        setRejected((r) => ({ count: (r?.message === message ? r.count : 0) + drop.length, message }));
        reload(); // e.g. SESSION_VERIFIED: show the board as closed
      }
      // Anything else (no signal, timeout): keep the taps and retry.
    } finally {
      sending.current = false;
      inFlight.current = new Set();
    }
  }, [keeperId, sessionId, reload]);

  // Autosave 3s after the last tap, retry every 15s, and save when the signal returns or the app is hidden.
  useEffect(() => {
    if (queue.length === 0) return;
    const soon = setTimeout(() => void flush(), 3000);
    const retry = setInterval(() => void flush(), 15_000);
    return () => { clearTimeout(soon); clearInterval(retry); };
  }, [queue, flush]);
  useEffect(() => () => void flush(), [flush]); // leaving the board (← Games) saves too
  useEffect(() => {
    const up = () => { setOnline(true); void flush(); };
    const down = () => setOnline(false);
    const hidden = () => { if (document.visibilityState === 'hidden') void flush(); };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [flush]);

  const saved = useMemo(() => (data.data?.taps ?? []).map(rowToTap), [data.data]);
  const savedIds = useMemo(() => new Set(saved.map((t) => t.id)), [saved]);
  const queued = useMemo(
    () => unsavedTaps(sent, queue, savedIds).map((q) => queuedToTap(q, keeperId)),
    [savedIds, sent, queue, keeperId],
  );
  // Display only: queued times aren't skew-corrected yet. Verify recomputes from the server's taps.
  const counts = useMemo(
    () => mergeTaps([...saved, ...queued], season.settings.tap_merge_seconds).counts,
    [saved, queued, season.settings.tap_merge_seconds],
  );

  if (data.error && !data.data) {
    return (
      <section className="page">
        <p><button className="linklike" onClick={onBack}>← Games</button></p>
        <p className="error" role="alert">{data.error}</p>
      </section>
    );
  }
  if (!data.data) return <Loading />;
  const { session, athletes, game, outs, lastStarted, owned, title, picked } = data.data;
  // The current season's stat buttons may not match an old season's stats, so an old-season session is read-only:
  // taps already queued on the phone still upload, but new taps and undo are disabled.
  const oldSeason = session.season_id !== season.id;
  const verified = sessionState(session, season.settings.stat_lock_hours) !== 'open';
  const closed = oldSeason || verified;
  const stats = Object.keys(season.settings.stat_weights);
  const query = search.trim().toLowerCase();
  const shown = athletes.filter((a) => a.name.toLowerCase().includes(query));
  // Ruling 15: whoever any team starts this game, then everyone else, both A→Z; headings only when not searching.
  const groups = [['Picked this game', shown.filter((a) => picked?.has(a.id))], ['Everyone else', shown.filter((a) => !picked?.has(a.id))]] as const;
  const headed = !query && groups[0][1].length > 0;

  const add = (athleteId: string, stat: string) =>
    setQueue((q) => [...q, { id: crypto.randomUUID(), athlete_id: athleteId, stat, tapped_at: new Date().toISOString(), undoes: null }]);

  /** Hold a stat button (or press minus): send an undo of this keeper's latest live tap of that athlete + stat. */
  function subtract(athleteId: string, stat: string) {
    const target = lastUndoable(saved, queued, keeperId, athleteId, stat);
    if (!target) {
      setHint(subtractHint(counts[athleteId]?.[stat] ?? 0));
      return;
    }
    setHint(null);
    if (canForgetLocally(target.id, queue, inFlight.current, savedIds)) {
      setQueue((q) => q.filter((t) => t.id !== target.id)); // never sent: just forget it
    } else {
      setQueue((q) => [...q, {
        id: crypto.randomUUID(), athlete_id: target.athleteId, stat: target.stat,
        tapped_at: new Date().toISOString(), undoes: target.id,
      }]);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const weight = (stat: string) => season.settings.stat_weights[stat] ?? 0;
  const card = (a: AthleteRow) => {
    const from = outs.get(a.id); // the open Out's first game
    const mine = owned.has(a.id); // another keeper tallies players on your own fantasy team
    // Out of this game: one line, nothing to tap; a keeper clears the Out first. Out from a later game: he still plays this one.
    const out = from !== undefined && game !== null && from <= game.number;
    return (
      <li key={a.id} className="tally-card">
        <div className="tally-head">
          <strong>{a.name}</strong>
          {mine && <span className="pill">On your team</span>}
          {from !== undefined && <span className="pill bad">{game && from > lastStarted ? `Out from game ${from}` : 'Out'}</span>}
          {game && !closed && (from === undefined
            ? <button className="secondary" aria-label={`Mark ${a.name} out from the next game`} onClick={() => void run(() => api.setOut(game.stage_id, a.id))}>Mark out</button>
            : <button className="secondary" aria-label={`Clear ${a.name}'s Out`} onClick={() => void run(() => api.clearOut(game.stage_id, a.id))}>Clear out</button>)}
        </div>
        {!out && (
          <div className="tally-buttons">
            {stats.map((stat) => (
              <StatButton key={stat} athlete={a.name} stat={stat} count={counts[a.id]?.[stat] ?? 0} weight={weight(stat)}
                disabled={closed || mine} onAdd={() => add(a.id, stat)} onSubtract={() => subtract(a.id, stat)} />
            ))}
          </div>
        )}
      </li>
    );
  };
  return (
    <section className="page">
      <div className="tally-bar">
        <div className="head">
          <button className="linklike" onClick={onBack}>← Games</button>
          <strong>{title}</strong>
        </div>
        <div className="head">
          <span role="status">
            {queue.length === 0 && <span className="pill ok">Saved ✓</span>}
            {queue.length > 0 && online && <span className="pill info">Saving · {queue.length} unsaved</span>}
            {queue.length > 0 && !online && <span className="pill warn">Offline · {queue.length} unsaved</span>}
          </span>
          <label className="check">
            <input type="checkbox" checked={bright} onChange={(e) => {
              try { localStorage.setItem(BRIGHT_KEY, e.target.checked ? '1' : '0'); } catch { /* storage blocked: lasts until you leave the board */ }
              setBright(e.target.checked);
            }} />
            Bright board
          </label>
        </div>
      </div>
      {verified && <p className="notice">This session is verified, so tallying is closed. <Link to={`/stats/${sessionId}`}>View it</Link>.</p>}
      {closed && !verified && <p className="notice">Earlier season: tallying closed.</p>}
      {!stored && <p className="error" role="alert">This phone won't store taps. Keep this page open until it says Saved.</p>}
      {rejected && <p className="error" role="alert">{rejected.count} {rejected.count === 1 ? 'tap' : 'taps'} not saved: {rejected.message} <button className="linklike" onClick={() => setRejected(null)}>Dismiss</button></p>}
      {error && <p className="error" role="alert">{error}</p>}
      {data.error && <p className="error" role="alert">Couldn't refresh: {data.error}</p>}
      <input type="search" aria-label="Find a player" placeholder="Find a player" value={search} onChange={(e) => setSearch(e.target.value)} />
      <p className="muted">Hold a stat to take one off.</p>
      {hint && <p className="notice" role="status">{hint} <button className="linklike" onClick={() => setHint(null)}>Dismiss</button></p>}
      {groups.map(([heading, list]) => list.length > 0 && (
        <Fragment key={heading}>
          {headed && <h2>{heading}</h2>}
          <ul className="list">{list.map(card)}</ul>
        </Fragment>
      ))}
      <GameControls season={season} sessionId={sessionId} unsaved={new Map([[sessionId, queue.length]])} />
    </section>
  );
}

const HOLD_MS = 500;

/** Tap = +1. Hold, or press minus / Delete / Backspace while focused = −1, with a buzz and a flash so it never reads as a tap. */
export function StatButton({ athlete, stat, count, weight, disabled, onAdd, onSubtract }: {
  athlete: string; stat: string; count: number; weight: number; disabled: boolean; onAdd: () => void; onSubtract: () => void;
}) {
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const [flash, setFlash] = useState(false);
  const minus = () => {
    navigator.vibrate?.(40);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 300);
    onSubtract();
  };
  const cancel = () => window.clearTimeout(timer.current);
  useEffect(() => cancel, []);
  const cls = [weight < 0 ? 'neg' : '', flash ? 'minus' : ''].filter(Boolean).join(' ') || undefined;
  return (
    <button className={cls} disabled={disabled} aria-keyshortcuts="- Delete Backspace"
      aria-label={`${athlete}, ${statLabel(stat)}: ${count}. Tap to add one; hold, or press minus, Delete or Backspace, to take one off.`}
      onPointerDown={() => {
        held.current = false;
        cancel();
        timer.current = window.setTimeout(() => { held.current = true; minus(); }, HOLD_MS);
      }}
      onPointerUp={cancel} onPointerLeave={cancel} onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (held.current) { held.current = false; return; } // the hold already took one off; never also add
        onAdd();
      }}
      onKeyDown={(e) => {
        if (e.key === '-' || e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); minus(); }
      }}>
      {statLabel(stat)}
      <span className="tally-count">{count}</span>
      <span className="tally-w">{weight > 0 ? '+' : weight < 0 ? '−' : ''}{Math.abs(weight)} pts</span>
    </button>
  );
}
