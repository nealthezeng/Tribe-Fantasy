import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { mergeTaps } from '../../core/taps';
import { useAuth } from '../auth/AuthProvider';
import { loadOwnedAthletes } from '../lib/auction';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import {
  gameTitles, loadCurrentSeason, SESSION_COLUMNS, sessionState, sessionTitle, statLabel,
  type CurrentSeason, type SessionRow,
} from '../lib/stats';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { GameControls } from './GameControls';
import {
  BATCH_MAX, canForgetLocally, isRejection, lastUndoable, loadQueue, notFoundDrop, queuedSessions, queuedToTap, removeSent,
  rowToTap, storeQueue, subtractHint, unsavedTaps,
  type QueuedTap, type StatTapRow,
} from '../tally/queue';

export function TallyPage() {
  const { session, isKeeper, loading } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const season = useLoad(loadCurrentSeason, []);
  if (loading) return <p className="muted" role="status">Loading…</p>;
  if (!session || !isKeeper) return <Navigate to="/" replace />;
  if (season.error) return <p className="error" role="alert">{season.error}</p>;
  if (season.data === null) return <p>No season yet.</p>;
  if (!season.data) return <p className="muted" role="status">Loading…</p>;
  return sessionId ? (
    <TallyBoard key={sessionId} season={season.data} sessionId={sessionId} keeperId={session.user.id} onBack={() => setSessionId(null)} />
  ) : (
    <SessionPicker season={season.data} keeperId={session.user.id} onPick={setSessionId} />
  );
}

function SessionPicker({ season, keeperId, onPick }: {
  season: CurrentSeason; keeperId: string; onPick: (id: string) => void;
}) {
  // Taps still on this phone, so they're never stranded: their sessions are listed even once verified.
  const [unsaved] = useState(() => new Map(queuedSessions(keeperId).map((q) => [q.sessionId, q.count])));
  // Tournament games only (T4): practice tallying is retired. A non-game session shows up only to drain this phone's taps.
  const sessions = useLoad(async () => {
    const open = `and(season_id.eq.${season.id},verified_at.is.null)`;
    const { data, error } = await supabase!.from('sessions').select(SESSION_COLUMNS)
      .or(unsaved.size ? `${open},id.in.(${[...unsaved.keys()].join(',')})` : open)
      .order('held_on', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as SessionRow[];
    const game = await gameTitles(rows.map((s) => s.id));
    return rows.filter((s) => game.has(s.id) || unsaved.has(s.id)).map((s) => ({ ...s, game: game.get(s.id) ?? null }));
  }, [season.id, unsaved]);

  return (
    <section className="page">
      <h1>Tally</h1>
      <GameControls season={season} onOpen={onPick} unsaved={unsaved} />
      <div className="card">
        <h2>Open games</h2>
        {!sessions.data && !sessions.error && <p className="muted" role="status">Loading…</p>}
        {sessions.data?.length === 0 && <p className="muted">No open games.</p>}
        <ul className="list">
          {sessions.data?.map((s) => (
            <li key={s.id}>
              <span className="meta">
                <span className="title">{s.game ?? sessionTitle(s)}</span>
                {unsaved.has(s.id) && <span className="pill warn">{unsaved.get(s.id)} unsaved</span>}
              </span>
              <button className={s.verified_at ? 'secondary' : ''} onClick={() => onPick(s.id)}>{s.verified_at ? 'Open' : 'Tally'}</button>
            </li>
          ))}
        </ul>
        {sessions.error && <p className="error" role="alert">{sessions.error}</p>}
      </div>
    </section>
  );
}

interface AthleteRow { id: string; name: string }
interface AttendanceRow { athlete_id: string; status: 'present' | 'absent' }
interface InjuryRow { id: string; athlete_id: string; confirmed_at: string | null }

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
  const queueRef = useRef(queue);
  const sending = useRef(false);
  const inFlight = useRef<Set<string>>(new Set());

  const data = useLoad(async () => {
    const sess = await supabase!.from('sessions').select(SESSION_COLUMNS).eq('id', sessionId).single();
    if (sess.error) throw sess.error;
    // The session's own season: a queued session from an earlier season must show that season's athletes.
    const seasonId = (sess.data as SessionRow).season_id;
    const [athletes, taps, attendance, injuries, owned] = await Promise.all([
      supabase!.from('athletes').select('id, name').eq('season_id', seasonId).eq('opted_in', true).order('name'),
      supabase!.from('stat_taps').select('id, athlete_id, stat, keeper_id, tapped_at, undoes').eq('session_id', sessionId),
      supabase!.from('attendance').select('athlete_id, status').eq('session_id', sessionId),
      supabase!.from('injuries').select('id, athlete_id, confirmed_at').is('cleared_at', null),
      // The server refuses a keeper's taps on their own players (OWNS_ATHLETE); admins may tally anyone (t120).
      isAdmin ? new Set<string>() : loadOwnedAthletes(keeperId, seasonId).catch(() => new Set<string>()),
    ]);
    for (const r of [athletes, taps, attendance, injuries]) if (r.error) throw r.error;
    return {
      session: sess.data as SessionRow,
      athletes: (athletes.data ?? []) as AthleteRow[],
      taps: (taps.data ?? []) as StatTapRow[],
      attendance: (attendance.data ?? []) as AttendanceRow[],
      injuries: (injuries.data ?? []) as InjuryRow[],
      owned,
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
        if (String((err as { message?: string }).message).trim() === 'NOT_FOUND') {
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
        setRejected((r) => ({ count: (r?.count ?? 0) + drop.length, message }));
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

  if (data.error && !data.data) return <p className="error" role="alert">{data.error}</p>;
  if (!data.data) return <p className="muted" role="status">Loading…</p>;
  const { session, athletes, attendance, injuries, owned } = data.data;
  // The current season's stat buttons may not match an old season's stats, so an old-season session is read-only:
  // taps already queued on the phone still upload, but new taps and undo are disabled.
  const oldSeason = session.season_id !== season.id;
  const verified = sessionState(session, season.settings.stat_lock_hours) !== 'open';
  const closed = oldSeason || verified;
  const stats = Object.keys(season.settings.stat_weights);
  const statusOf = new Map(attendance.map((a) => [a.athlete_id, a.status]));
  const injuryOf = new Map(injuries.map((i) => [i.athlete_id, i]));
  const shown = athletes.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase()));

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
  return (
    <section className="page">
      <div className="tally-bar">
        <div className="head">
          <button className="linklike" onClick={onBack}>← Games</button>
          <strong>{sessionTitle(session)}</strong>
        </div>
        <div className="head">
          <span role="status">
            {queue.length === 0 && <span className="pill ok">Saved ✓</span>}
            {queue.length > 0 && online && <span className="pill info">Saving · {queue.length} unsaved</span>}
            {queue.length > 0 && !online && <span className="pill warn">Offline · {queue.length} unsaved</span>}
          </span>
        </div>
        <GameControls season={season} sessionId={sessionId} unsaved={new Map([[sessionId, queue.length]])} />
      </div>
      {verified && <p className="notice">This session is verified, so tallying is closed. <Link to={`/stats/${sessionId}`}>View it</Link>.</p>}
      {closed && !verified && <p className="notice">This session is from an earlier season, so tallying is closed here. Taps already saved on this phone still upload.</p>}
      {!stored && <p className="error" role="alert">This phone won't store taps. Keep this page open until it says Saved.</p>}
      {rejected && <p className="error" role="alert">{rejected.count} {rejected.count === 1 ? 'tap' : 'taps'} not saved: {rejected.message} <button className="linklike" onClick={() => setRejected(null)}>Dismiss</button></p>}
      {error && <p className="error" role="alert">{error}</p>}
      {data.error && <p className="error" role="alert">Couldn't refresh: {data.error}</p>}
      <input type="search" aria-label="Find a player" placeholder="Find a player" value={search} onChange={(e) => setSearch(e.target.value)} />
      <p className="muted">A Callahan is one tap: it already includes the goal and the D. Tapped too many? Hold the button to take one off.</p>
      {hint && <p className="notice" role="status">{hint} <button className="linklike" onClick={() => setHint(null)}>Dismiss</button></p>}
      <ul className="list">
        {shown.map((a) => {
          const injury = injuryOf.get(a.id);
          const status = statusOf.get(a.id);
          const mine = owned.has(a.id); // another keeper tallies players on your own fantasy team
          return (
            <li key={a.id} className="tally-card">
              <div className="tally-head">
                <strong>{a.name}</strong>
                {mine && <span className="pill">On your team</span>}
                {injury && <span className={injury.confirmed_at ? 'pill bad' : 'pill warn'}>{injury.confirmed_at ? 'Injured' : 'Injury reported'}</span>}
                {injury && !injury.confirmed_at && !mine && (
                  <button className="secondary" onClick={() => void run(() => api.confirmInjury(injury.id))}>Confirm injury</button>
                )}
                <button className="secondary" disabled={mine} aria-label={`${a.name}: ${status ?? 'not marked'}. Tap to mark ${status === 'present' ? 'absent' : 'present'}.`}
                  onClick={() => void run(() => api.setAttendance(sessionId, a.id, status === 'present' ? 'absent' : 'present'))}>
                  {status === 'present' ? 'Present ✓' : status === 'absent' ? 'Absent' : 'Mark present'}
                </button>
              </div>
              <div className="tally-buttons">
                {stats.map((stat) => (
                  <StatButton key={stat} athlete={a.name} stat={stat} count={counts[a.id]?.[stat] ?? 0} weight={weight(stat)}
                    disabled={closed || mine} onAdd={() => add(a.id, stat)} onSubtract={() => subtract(a.id, stat)} />
                ))}
              </div>
            </li>
          );
        })}
      </ul>
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
