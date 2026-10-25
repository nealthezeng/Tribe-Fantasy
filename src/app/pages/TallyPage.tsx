import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, Navigate, useBlocker, useSearchParams } from 'react-router';
import { parseSettings } from '../../core/settings';
import { mergeTaps } from '../../core/taps';
import { parseStats, type VoiceEvent } from '../../core/voice';
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
import { VoiceMic } from './VoiceMic';
import {
  BATCH_MAX, canForgetLocally, errorCode, isRejection, lastUndoable, loadQueue, notFoundDrop, queuedSessions, queuedToTap, removeSent,
  rowToTap, storeQueue, subtractHint, unsavedTaps,
  type QueuedTap, type StatTapRow,
} from '../tally/queue';
import { canRecord } from '../tally/useRecorder';
import {
  addable, bump, drop, joinCall, listStats, toQueued, waitingCount, type VoiceNote, type WaitingSet,
} from '../tally/waiting';

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
  // Unsaved taps (X2): only sessions this phone still holds taps for, outside the hub (the current tournament's games,
  // unsaved taps too, are rows on GameControls' card), so they can upload. Nothing else gets a board link here: an
  // earlier tournament's open game opens from Stats, and admins get the stuck-game warning.
  const sessions = useLoad(async () => {
    if (unsaved.size === 0) return [];
    const { data, error } = await supabase!.from('sessions').select(SESSION_COLUMNS).in('id', [...unsaved.keys()])
      .order('held_on', { ascending: false });
    if (error) throw error;
    const rows = (data ?? []) as SessionRow[];
    const [game, current] = await Promise.all([gameTitles(rows.map((s) => s.id)), loadCurrentGame(season.id)]);
    const hub = new Set(current?.games.map((g) => g.session_id));
    return rows.filter((s) => !hub.has(s.id) && unsaved.has(s.id)).map((s) => ({ ...s, game: game.get(s.id) ?? null }));
  }, [season.id, unsaved]);

  return (
    <section className="page">
      <h1>Tally</h1>
      <GameControls season={season} onOpen={onPick} unsaved={unsaved} />
      <OutList season={season} />
      {(sessions.error || !!sessions.data?.length) && (
        <div className="card">
          <h2>Unsaved taps</h2>
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
/** A heard call moves in only once the player lists have been left alone this long (ruling 5). */
const QUIET_MS = 1000;
const nStats = (n: number) => `${n} ${n === 1 ? 'stat' : 'stats'}`;

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
  // Voice (M16 §5.4): stats heard but not added yet (never stored on the phone), and the note by the mic.
  const [waiting, setWaiting] = useState<WaitingSet | null>(null);
  const [note, setNote] = useState<VoiceNote | null>(null);
  // Ruling 5: an answer waits until no finger is on the player lists and QUIET_MS has passed since the last one
  // lifted, so the Heard group never moves in under a keeper's thumb.
  const fingers = useRef(new Set<number>());
  const lifted = useRef(0);
  const calls = useRef<{ events: VoiceEvent[]; text: string; at: string }[]>([]);
  const revealTimer = useRef<number | undefined>(undefined);
  const reveal = useCallback(function reveal() {
    window.clearTimeout(revealTimer.current);
    if (calls.current.length === 0 || fingers.current.size > 0) return; // the last finger up tries again
    const wait = lifted.current + QUIET_MS - Date.now();
    if (wait > 0) {
      revealTimer.current = window.setTimeout(reveal, wait);
      return;
    }
    const done = calls.current.splice(0);
    setWaiting((w) => done.reduce<WaitingSet | null>((set, c) => joinCall(set, c.events, c.text, c.at), w));
    setNote((n) => (n?.undo ? null : n)); // a Discard's Undo now would wipe this call's stats
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const up = (e: PointerEvent) => {
      if (!fingers.current.delete(e.pointerId)) return;
      lifted.current = Date.now();
      reveal();
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.clearTimeout(revealTimer.current);
    };
  }, [reveal]);
  const touch = (e: ReactPointerEvent) => { fingers.current.add(e.pointerId); };

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
    const [athletes, taps, outs, started, owned, titles, picked, stored] = await Promise.all([
      supabase!.from('athletes').select('id, name').eq('season_id', seasonId).eq('opted_in', true).order('name'),
      supabase!.from('stat_taps').select('id, athlete_id, stat, keeper_id, tapped_at, undoes').eq('session_id', sessionId),
      game.data ? loadOpenOuts(game.data.stage_id as string) : new Map<string, number>(),
      // "Out from game N" reads only while game N hasn't started, whichever game's board this is.
      game.data ? supabase!.from('games').select('number').eq('stage_id', game.data.stage_id).not('started_at', 'is', null) : { data: [], error: null },
      // The server refuses a keeper's taps on their own players (OWNS_ATHLETE); admins may tally anyone (t120).
      isAdmin ? new Set<string>() : loadOwnedAthletes(keeperId, seasonId).catch(() => new Set<string>()),
      gameTitles([sessionId]),
      starters.current,
      // The voice switch, read on every load so an admin turning it off applies at the board's next refresh (§5.7).
      supabase!.from('seasons').select('settings').eq('id', seasonId).maybeSingle(),
    ]);
    for (const r of [athletes, taps, started]) if (r.error) throw r.error;
    let voice = false; // unreadable settings: no mic, the buttons still work
    try {
      voice = !stored.error && parseSettings((stored.data as { settings?: unknown } | null)?.settings).voice_tally;
    } catch { /* stays off */ }
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
      voice,
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
  const { session, athletes, game, outs, lastStarted, owned, title, picked, voice } = data.data;
  // The current season's stat buttons may not match an old season's stats, so an old-season session is read-only:
  // taps already queued on the phone still upload, but new taps and undo are disabled.
  const oldSeason = session.season_id !== season.id;
  const verified = sessionState(session, season.settings.stat_lock_hours) !== 'open';
  const closed = oldSeason || verified;
  const stats = Object.keys(season.settings.stat_weights);
  const query = search.trim().toLowerCase();
  // While stats wait, their players show only in the Heard group, in the order first named.
  const heardIds = new Set(waiting?.players.map((p) => p.athleteId));
  const heard = waiting ? waiting.players.flatMap((p) => athletes.filter((a) => a.id === p.athleteId)) : [];
  const shown = athletes.filter((a) => !heardIds.has(a.id) && a.name.toLowerCase().includes(query));
  // Ruling 15: whoever any team starts this game, then everyone else, both A→Z; headings only when not searching.
  const groups = [['Picked this game', shown.filter((a) => picked?.has(a.id))], ['Everyone else', shown.filter((a) => !picked?.has(a.id))]] as const;
  const headed = !query && groups[0][1].length > 0;
  // Whisper's hint and the example name: picked players first (their names survive a long roster's prompt cut).
  const names = [...athletes.filter((a) => picked?.has(a.id)), ...athletes.filter((a) => !picked?.has(a.id))].map((a) => a.name);
  const first = names[0]?.split(' ')[0];
  const voiceOn = voice && !closed && athletes.length > 0; // an empty board has no names to send (ruling T1a)
  const isOut = (id: string) => { // Out of this game; Out from a later game still plays this one
    const from = outs.get(id);
    return from !== undefined && game !== null && from <= game.number;
  };
  const canAdd = (id: string) => !owned.has(id) && !isOut(id); // ruling 8
  const adds = waiting ? addable(waiting, canAdd) : [];
  // Heard cards show what Add will make: the waiting stats merged in as this keeper's taps at their call's start.
  const preview = waiting ? mergeTaps(
    [...saved, ...queued, ...toQueued(adds).map((q) => queuedToTap(q, keeperId))], season.settings.tap_merge_seconds,
  ).counts : counts;

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

  function onHeard(text: string, at: string) {
    if (!voiceOn) return; // an answer landing after voice went off or the board closed
    const events = parseStats(text, athletes, stats);
    if (events.length === 0) {
      setNote({ text: `Heard “${text}” but no player and stat. Try “${first} gets a D”.` });
      return;
    }
    calls.current.push({ events, text, at });
    reveal();
  }
  /** Hold on a Heard card: one waiting stat off, never a saved one. */
  function fix(w: WaitingSet, athleteId: string, stat: string) {
    const next = drop(w, athleteId, stat);
    setHint(next ? null : 'Nothing waiting to take off.');
    if (next) setWaiting(next);
  }
  function addWaiting() {
    const taps = toQueued(adds);
    setQueue((q) => [...q, ...taps]);
    setWaiting(null);
    setNote({ text: `Added ${nStats(taps.length)}.` });
  }
  function discard() {
    const set = waiting;
    if (!set) return;
    setWaiting(null);
    setNote({ text: `Dropped ${nStats(set.stats.length)}.`, undo: () => setWaiting(set) });
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
  /** A player's card; `w` makes it a Heard card, whose buttons change the waiting stats instead of tapping. */
  const card = (a: AthleteRow, w: WaitingSet | null = null) => {
    const from = outs.get(a.id); // the open Out's first game
    const mine = owned.has(a.id); // another keeper tallies players on your own fantasy team
    const out = isOut(a.id); // one line, nothing to tap; a keeper clears the Out first
    return (
      <li key={a.id} className="tally-card">
        <div className="tally-head">
          <strong>{a.name}</strong>
          {mine && <span className="pill">On your team</span>}
          {from !== undefined && <span className="pill bad">{game && from > lastStarted ? `Out from game ${from}` : 'Out'}</span>}
          {w && !canAdd(a.id) && <span className="pill warn">Not added</span>}
          {game && !closed && (from === undefined
            ? <button className="secondary" aria-label={`Mark ${a.name} out from the next game`} onClick={() => void run(() => api.setOut(game.stage_id, a.id))}>Mark out</button>
            : <button className="secondary" aria-label={`Clear ${a.name}'s Out`} onClick={() => void run(() => api.clearOut(game.stage_id, a.id))}>Clear out</button>)}
        </div>
        {!out && (
          <div className="tally-buttons">
            {stats.map((stat) => (
              <StatButton key={stat} athlete={a.name} stat={stat} count={(w ? preview : counts)[a.id]?.[stat] ?? 0}
                mark={w ? waitingCount(w, a.id, stat) : undefined} weight={weight(stat)} disabled={closed || mine}
                onAdd={() => (w ? setWaiting((cur) => cur && bump(cur, a.id, stat)) : add(a.id, stat))}
                onSubtract={() => (w ? fix(w, a.id, stat) : subtract(a.id, stat))} />
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
      {verified && <p className="notice">This game is verified, so tallying is closed. <Link to={`/stats/${sessionId}`}>View it</Link>.</p>}
      {closed && !verified && <p className="notice">Earlier season: tallying closed.</p>}
      {!stored && <p className="error" role="alert">This phone won't store taps. Keep this page open until it says Saved.</p>}
      {rejected && <p className="error" role="alert">{rejected.count} {rejected.count === 1 ? 'tap' : 'taps'} not saved: {rejected.message} <button className="linklike" onClick={() => setRejected(null)}>Dismiss</button></p>}
      {error && <p className="error" role="alert">{error}</p>}
      {data.error && <p className="error" role="alert">Couldn't refresh: {data.error}</p>}
      <input type="search" aria-label="Find a player" placeholder="Find a player" value={search} onChange={(e) => setSearch(e.target.value)} />
      {voiceOn && canRecord() && <p className="muted">Or hold the mic and say “{first} gets a D”. Nothing is added until you tap Add.</p>}
      <p className="muted">Hold a stat to take one off.</p>
      {hint && <p className="notice" role="status">{hint} <button className="linklike" onClick={() => setHint(null)}>Dismiss</button></p>}
      {waiting && (
        <>
          <p className="voice-heard" role="status">“{waiting.heard}”</p>
          <ul className="list" onPointerDown={touch}>{heard.map((a) => card(a, waiting))}</ul>
          <p className="muted">Not added yet. Tap a stat to add one, hold to take one off.</p>
        </>
      )}
      {groups.map(([heading, list]) => list.length > 0 && (
        <Fragment key={heading}>
          {headed && <h2>{heading}</h2>}
          <ul className="list" onPointerDown={touch}>{list.map((a) => card(a))}</ul>
        </Fragment>
      ))}
      {/* Finish stays off while stats wait (§5.4): it pairs the next game from this one's results. */}
      <GameControls season={season} sessionId={sessionId} unsaved={new Map([[sessionId, queue.length + adds.length]])} />
      {/* A direct child of the page: inside a .card's backdrop-filter its position: fixed would be trapped (T6a). The
          mic only while voice is on (`talk`); the Discard / Add bar stays while stats wait even if the board closes or
          voice goes off, so they can still be added or dropped (T7a), and so does a note (Discard's Undo). */}
      {(voiceOn || waiting !== null || note !== null) && (
        <VoiceMic names={names} talk={voiceOn} online={online} waiting={waiting ? adds.length : null} note={note}
          onNote={setNote} onHeard={onHeard} onAdd={addWaiting} onDiscard={discard} />
      )}
      {waiting && adds.length > 0 && (
        <LeaveGuard onDrop={() => setWaiting(null)} ask={`Leave and drop ${nStats(adds.length)} you haven't added: ${listStats(
          waiting.players.flatMap((p) => adds.filter((s) => s.athleteId === p.athleteId)), // top to bottom, as shown
          (id) => athletes.find((a) => a.id === id)?.name ?? '',
        )}?`} />
      )}
    </section>
  );
}

/**
 * Leaving the board inside the app while stats wait asks first, naming them (§5.8). useBlocker needs a data router, so
 * the board mounts this only while stats wait (plan ruling 4; the older board tests render in a MemoryRouter).
 */
function LeaveGuard({ ask, onDrop }: { ask: string; onDrop: () => void }) {
  const blocker = useBlocker(true);
  const id = useId();
  if (blocker.state !== 'blocked') return null;
  return (
    <div className="voice-leave" role="alertdialog" aria-modal="true" aria-labelledby={id}>
      <div className="stack">
        <p id={id}>{ask}</p>
        <div className="row">
          <button className="secondary" autoFocus onClick={() => blocker.reset()}>Stay</button>
          <button onClick={() => { blocker.proceed(); onDrop(); }}>Drop and leave</button>
        </div>
      </div>
    </div>
  );
}

const HOLD_MS = 500;

/** Tap = +1. Hold, or press minus / Delete / Backspace while focused = −1, with a buzz and a flash so it never reads as a tap. */
export function StatButton({ athlete, stat, count, weight, disabled, mark = 0, onAdd, onSubtract }: {
  athlete: string; stat: string; count: number; weight: number; disabled: boolean;
  mark?: number; // voice stats in `count` still waiting for Add (M16): outlined, with a "+N" badge
  onAdd: () => void; onSubtract: () => void;
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
  const cls = [weight < 0 ? 'neg' : '', mark > 0 ? 'waiting' : '', flash ? 'minus' : ''].filter(Boolean).join(' ') || undefined;
  return (
    <button className={cls} disabled={disabled} aria-keyshortcuts="- Delete Backspace"
      aria-label={`${athlete}, ${statLabel(stat)}: ${count}${mark > 0 ? `, ${mark} waiting` : ''}. Tap to add one; hold, or press minus, Delete or Backspace, to take one off.`}
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
      {mark > 0 && <span className="tally-new">+{mark}</span>}
    </button>
  );
}
