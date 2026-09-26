import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router';
import { mergeTaps } from '../../core/taps';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import {
  loadCurrentSeason, SESSION_COLUMNS, sessionState, statLabel, todayLocal,
  type CurrentSeason, type SessionRow,
} from '../lib/stats';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import {
  BATCH_MAX, canForgetLocally, isRejection, lastUndoable, loadQueue, queuedSessions, queuedToTap, removeSent, rowToTap,
  storeQueue, unsavedTaps,
  type QueuedTap, type StatTapRow,
} from '../tally/queue';

export function TallyPage() {
  const { session, isKeeper, loading } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const season = useLoad(loadCurrentSeason, []);
  if (loading) return <p>Loading…</p>;
  if (!session || !isKeeper) return <Navigate to="/" replace />;
  if (season.error) return <p className="error">{season.error}</p>;
  if (!season.data) return <p>{season.data === null ? 'No season yet.' : 'Loading…'}</p>;
  return sessionId ? (
    <TallyBoard key={sessionId} season={season.data} sessionId={sessionId} keeperId={session.user.id} onBack={() => setSessionId(null)} />
  ) : (
    <SessionPicker season={season.data} keeperId={session.user.id} onPick={setSessionId} />
  );
}

function SessionPicker({ season, keeperId, onPick }: {
  season: CurrentSeason; keeperId: string; onPick: (id: string) => void;
}) {
  const [heldOn, setHeldOn] = useState(todayLocal());
  const [kind, setKind] = useState<'practice' | 'tournament'>('practice');
  const [counts, setCounts] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Taps still on this phone, so they're never stranded: their sessions are listed even once verified.
  const [unsaved] = useState(() => new Map(queuedSessions(keeperId).map((q) => [q.sessionId, q.count])));
  const sessions = useLoad(async () => {
    const open = `and(season_id.eq.${season.id},verified_at.is.null)`;
    const { data, error } = await supabase!.from('sessions').select(SESSION_COLUMNS)
      .or(unsaved.size ? `${open},id.in.(${[...unsaved.keys()].join(',')})` : open)
      .order('held_on', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SessionRow[];
  }, [season.id, unsaved]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      onPick(await api.createSession(season.id, kind, heldOn, counts));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section>
      <h1>Tally</h1>
      <div className="card">
        <h2>Open sessions</h2>
        {sessions.data?.length === 0 && <p>None yet. Start one below.</p>}
        <ul className="list">
          {sessions.data?.map((s) => (
            <li key={s.id}>
              <span>
                {s.held_on} · {s.kind}{s.counts ? '' : ' (not counted)'}
                {unsaved.has(s.id) && <strong> · {unsaved.get(s.id)} unsaved taps</strong>}
              </span>
              <button onClick={() => onPick(s.id)}>{s.verified_at ? 'Open' : 'Tally'}</button>
            </li>
          ))}
        </ul>
      </div>
      <form className="card" onSubmit={create}>
        <h2>New session</h2>
        <label>Date<input type="date" required value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></label>
        <label>Type
          <select value={kind} onChange={(e) => setKind(e.target.value as 'practice' | 'tournament')}>
            <option value="practice">Practice</option>
            <option value="tournament">Tournament</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={counts} onChange={(e) => setCounts(e.target.checked)} />
          Counts for fantasy (untick for drills)
        </label>
        <button>Start tallying</button>
        {(error || sessions.error) && <p className="error">{error ?? sessions.error}</p>}
      </form>
    </section>
  );
}

interface AthleteRow { id: string; name: string }
interface AttendanceRow { athlete_id: string; status: 'present' | 'absent' }
interface InjuryRow { id: string; athlete_id: string; confirmed_at: string | null }

function TallyBoard({ season, sessionId, keeperId, onBack }: {
  season: CurrentSeason; sessionId: string; keeperId: string; onBack: () => void;
}) {
  const [queue, setQueue] = useState<QueuedTap[]>(() => loadQueue(keeperId, sessionId));
  // Saved batches until the reload shows them, so counts and "Undo last tap" don't skip them meanwhile.
  const [sent, setSent] = useState<QueuedTap[]>([]);
  const [stored, setStored] = useState(true);
  const [rejected, setRejected] = useState<{ count: number; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [search, setSearch] = useState('');
  const queueRef = useRef(queue);
  const sending = useRef(false);
  const inFlight = useRef<Set<string>>(new Set());

  const data = useLoad(async () => {
    const sess = await supabase!.from('sessions').select(SESSION_COLUMNS).eq('id', sessionId).single();
    if (sess.error) throw sess.error;
    // The session's own season: a queued session from an earlier season must show that season's athletes.
    const seasonId = (sess.data as SessionRow).season_id;
    const [athletes, taps, attendance, injuries] = await Promise.all([
      supabase!.from('athletes').select('id, name').eq('season_id', seasonId).eq('opted_in', true).order('name'),
      supabase!.from('stat_taps').select('id, athlete_id, stat, keeper_id, tapped_at, undoes').eq('session_id', sessionId),
      supabase!.from('attendance').select('athlete_id, status').eq('session_id', sessionId),
      supabase!.from('injuries').select('id, athlete_id, confirmed_at').is('cleared_at', null),
    ]);
    for (const r of [athletes, taps, attendance, injuries]) if (r.error) throw r.error;
    return {
      session: sess.data as SessionRow,
      athletes: (athletes.data ?? []) as AthleteRow[],
      taps: (taps.data ?? []) as StatTapRow[],
      attendance: (attendance.data ?? []) as AttendanceRow[],
      injuries: (injuries.data ?? []) as InjuryRow[],
    };
  }, [sessionId]);
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
        setQueue((q) => removeSent(q, batch));
        setRejected((r) => ({ count: (r?.count ?? 0) + batch.length, message: errorMessage(err) }));
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
  useEffect(() => () => void flush(), [flush]); // leaving the board (← Sessions) saves too
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

  if (data.error && !data.data) return <p className="error">{data.error}</p>;
  if (!data.data) return <p>Loading…</p>;
  const { session, athletes, attendance, injuries } = data.data;
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

  function undo() {
    const target = lastUndoable(saved, queued, keeperId);
    if (!target) return;
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

  const syncText = queue.length === 0 ? 'Saved ✓' : `${online ? '' : 'Offline · '}${queue.length} unsaved`;
  return (
    <section>
      <div className="tally-bar">
        <button className="linklike" onClick={onBack}>← Sessions</button>
        <span>{session.held_on} · {session.kind}</span>
        <span className={queue.length ? 'muted' : ''}>{syncText}</span>
        <button onClick={undo} disabled={closed}>Undo last tap</button>
      </div>
      {verified && <p className="notice">This session is verified, so tallying is closed. <Link to={`/stats/${sessionId}`}>View it</Link>.</p>}
      {closed && !verified && <p className="notice">This session is from an earlier season, so tallying is closed here. Taps already saved on this phone still upload.</p>}
      {!stored && <p className="error">This phone won't store taps. Keep this page open until it says Saved.</p>}
      {rejected && <p className="error">{rejected.count} taps not saved: {rejected.message} <button className="linklike" onClick={() => setRejected(null)}>Dismiss</button></p>}
      {error && <p className="error">{error}</p>}
      {data.error && <p className="error">Couldn't refresh: {data.error}</p>}
      <input type="search" placeholder="Find a player" value={search} onChange={(e) => setSearch(e.target.value)} />
      <p className="muted">A Callahan is one tap: it already includes the goal and the D.</p>
      <ul className="list">
        {shown.map((a) => {
          const injury = injuryOf.get(a.id);
          const status = statusOf.get(a.id);
          return (
            <li key={a.id} className="tally-card">
              <div className="tally-head">
                <strong>{a.name}</strong>
                {injury && <span className="badge">{injury.confirmed_at ? 'Injured' : 'Injury reported'}</span>}
                {injury && !injury.confirmed_at && (
                  <button className="linklike" onClick={() => void run(() => api.confirmInjury(injury.id))}>Confirm injury</button>
                )}
                <button className="linklike" onClick={() =>
                  void run(() => api.setAttendance(sessionId, a.id, status === 'present' ? 'absent' : 'present'))}>
                  {status === 'present' ? 'Present' : status === 'absent' ? 'Absent' : 'Mark present'}
                </button>
              </div>
              <div className="tally-buttons">
                {stats.map((stat) => (
                  <button key={stat} disabled={closed} onClick={() => add(a.id, stat)}>
                    {statLabel(stat)}<span className="tally-count">{counts[a.id]?.[stat] ?? 0}</span>
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
