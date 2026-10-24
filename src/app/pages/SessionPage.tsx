import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { parseSettings } from '../../core/settings';
import { mergeTaps } from '../../core/taps';
import { liveStatLines } from '../../core/tournament';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../components/Loading';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { SESSION_COLUMNS, sessionState, sessionTitle, statLabel, type SessionRow } from '../lib/stats';
import { supabase } from '../lib/supabase';
import { loadLiveTaps } from '../lib/tournament';
import { useLoad, usePoll } from '../lib/useLoad';
import { gameName, rowStatus } from '../lib/words';
import { errorCode, rowToTap, type StatTapRow } from '../tally/queue';
import { totals } from '../lib/statsTable';
import { Status, StatTable } from './StatTable';

interface LineRow { athlete_id: string; stats: Record<string, number> }
interface GameInfo {
  id: string; stage_id: string; number: number; opponent: string | null; started_at: string | null; finished_at: string | null;
  stages: { name: string } | null;
}

export function SessionPage() {
  const { id = '' } = useParams();
  const { session: auth, isKeeper, isAdmin } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const data = useLoad(async () => {
    const sess = await supabase!.from('sessions').select(SESSION_COLUMNS).eq('id', id).maybeSingle();
    if (sess.error) throw sess.error;
    if (!sess.data) return null;
    const s = sess.data as SessionRow;
    const [season, athletes, lines, taps, profiles, game] = await Promise.all([
      supabase!.from('seasons').select('settings').eq('id', s.season_id).single(),
      supabase!.from('athletes').select('id, name').eq('season_id', s.season_id),
      supabase!.from('stat_lines').select('athlete_id, stats').eq('session_id', id),
      // Keepers only (RLS returns nothing to members), so these two are harmless for everyone else.
      supabase!.from('stat_taps').select('id, athlete_id, stat, keeper_id, tapped_at, undoes').eq('session_id', id),
      supabase!.from('profiles').select('id, display_name'),
      supabase!.from('games').select('id, stage_id, number, opponent, started_at, finished_at, stages(name)').eq('session_id', id).maybeSingle(),
    ]);
    for (const r of [season, athletes, lines, taps, profiles, game]) if (r.error) throw r.error;
    const g = game.data as GameInfo | null; // none for an old practice session
    const settings = parseSettings(season.data!.settings);
    // Members can't read stat_taps: a started, unverified game's unofficial lines come through live_game_taps (keepers
    // verify from their own taps instead). An athlete-only account can't read those either (FORBIDDEN): no live lines.
    const live = !isKeeper && !s.verified_at && g?.started_at
      ? await loadLiveTaps([{ id: g.id, session_id: id }]).then(
        (t) => liveStatLines(id, t.map(rowToTap), settings).map((l): LineRow => ({ athlete_id: l.athleteId, stats: l.stats })),
        (e) => { if (errorCode(e) !== 'FORBIDDEN') throw e; return null; })
      : null;
    return {
      session: s,
      stageId: g?.stage_id ?? null,
      gameTitle: g ? gameName(g.number, g.opponent) : sessionTitle(s),
      stage: g?.stages?.name ?? null,
      // An old practice session has no game: it was held and finished on its day.
      status: rowStatus({ started_at: g ? g.started_at : s.held_on, finished_at: g ? g.finished_at : s.held_on, session_id: id, verified_at: s.verified_at }),
      live,
      settings,
      names: new Map((athletes.data ?? []).map((a: { id: string; name: string }) => [a.id, a.name])),
      lines: (lines.data ?? []) as LineRow[],
      taps: ((taps.data ?? []) as StatTapRow[]).map(rowToTap),
      people: new Map((profiles.data ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name])),
    };
  }, [id, isKeeper]);

  const merge = useMemo(
    () => (data.data ? mergeTaps(data.data.taps, data.data.settings.tap_merge_seconds) : null),
    [data.data],
  );
  const showLive = !isKeeper && !!data.data?.live; // keepers verify from their own taps below
  usePoll(data.reload, showLive); // live numbers move

  // Only a first load that failed has nothing to show; a failed reload (a poll, say) keeps the page under the error.
  if (data.data === undefined) return data.error ? <p className="error" role="alert">{data.error}</p> : <Loading />;
  if (data.data === null) return <p>That game's stats aren't here any more. <Link to="/stats">Stats</Link></p>;
  const { session, stageId, gameTitle, stage, status, live, settings, names, lines, taps, people } = data.data;
  const title = stage ? `${gameTitle} · ${stage}` : gameTitle;
  const toPlayer = (r: { key: string }) => `/player/${r.key}${stageId ? `?t=${stageId}` : ''}`;
  const state = sessionState(session, settings.stat_lock_hours);
  const stats = Object.keys(settings.stat_weights);
  const ofCounts = (counts: Record<string, Record<string, number>>) =>
    totals(Object.entries(counts).map(([athlete_id, stats]) => ({ athlete_id, stats })), names, settings.stat_weights);
  const name = (athleteId: string) => names.get(athleteId) ?? 'Unknown';
  // Keepers can't verify a game they tallied (VERIFIER_TAPPED); admins can (t120).
  const iTapped = !isAdmin && taps.some((t) => t.keeperId === auth?.user.id);
  const keepers = [...new Set(taps.map((t) => t.keeperId))];

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      data.reload(); // after a failure too: e.g. LINES_MISMATCH means the preview is stale
      setBusy(false);
    }
  }

  // Admin cleanup (t81): any session, verified or locked, with everything tallied in it.
  async function remove() {
    if (!window.confirm(`Delete all stats for ${title}? Past results and standings can change. This can't be undone.`)) return;
    setError(null);
    setBusy(true);
    try {
      await api.deleteSession(id, true);
      navigate('/stats');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const verify = () =>
    run(() => api.verifySession(id, Object.entries(merge!.counts).map(([athlete_id, s]) => ({ athlete_id, stats: s }))));

  return (
    <section className="page">
      <p><Link to={stageId ? `/stats?t=${stageId}` : '/stats'}>← Stats</Link></p>
      <div className="stack">
        <h1>{gameTitle}{stage && <> <small>{stage}</small></>}</h1>
        <p className="meta">
          <Status word={status} />
          {!session.counts && <span className="pill">Not counted</span>}
        </p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {data.error && <p className="error" role="alert">{data.error}</p>}

      {showLive && (
        <div className="card">
          <h2>Stats <small>unofficial</small></h2>
          <StatTable stats={stats} rows={totals(live!, names, settings.stat_weights)} href={toPlayer} />
        </div>
      )}

      {state !== 'open' && (
        <div className="card">
          <h2>Stats</h2>
          <StatTable stats={stats} rows={totals(lines, names, settings.stat_weights)} href={toPlayer} />
          {isKeeper && state === 'verified' && (
            <button className="secondary" disabled={busy} onClick={() => void run(() => api.reopenSession(id))}>Reopen tally</button>
          )}
          {isAdmin && state === 'locked' && (
            <CorrectForm stats={stats} lines={lines} names={names} onSave={(athlete, s) => run(() => api.correctStatLine(id, athlete, s))} />
          )}
        </div>
      )}

      {isKeeper && state === 'open' && merge && (
        <div className="card">
          <h2>Totals to verify</h2>
          <StatTable stats={stats} rows={ofCounts(merge.counts)} href={toPlayer} />
          {merge.merged.length > 0 && (
            <>
              <h3>Counted once ({merge.merged.length})</h3>
              <ul className="muted">
                {merge.merged.map((g) => (
                  <li key={g.tapIds.join()}>{name(g.athleteId)} · {statLabel(g.stat)} · tapped by {g.tapIds.length} keepers</li>
                ))}
              </ul>
            </>
          )}
          {keepers.map((k) => (
            <details key={k}>
              <summary>Tallied by {people.get(k) ?? 'a keeper'}</summary>
              <StatTable stats={stats} rows={ofCounts(mergeTaps(taps.filter((t) => t.keeperId === k), 0).counts)} legend={false} />
            </details>
          ))}
          {iTapped ? (
            <p className="notice">You tallied this game, so you can't verify it. A keeper who didn't tally it can, or an admin.</p>
          ) : (
            <button disabled={busy} onClick={() => void verify()}>{busy ? 'Verifying…' : 'Verify these totals'}</button>
          )}
          <p><Link to={`/tally?game=${id}`}>Back to tallying</Link></p>
        </div>
      )}

      {/* Last on the page and red-worded (ruling 81). */}
      {isAdmin && (
        <p><button className="danger-link" disabled={busy} onClick={() => void remove()}>Delete these stats</button></p>
      )}
    </section>
  );
}

function CorrectForm({ stats, lines, names, onSave }: {
  stats: string[];
  lines: LineRow[];
  names: Map<string, string>;
  onSave: (athleteId: string, stats: Record<string, number>) => Promise<void>;
}) {
  const [athlete, setAthlete] = useState('');
  const [values, setValues] = useState<Record<string, number>>({});
  const pick = (a: string) => {
    setAthlete(a);
    setValues(lines.find((l) => l.athlete_id === a)?.stats ?? {});
  };
  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v > 0));
    void onSave(athlete, clean);
  }
  return (
    <form onSubmit={submit}>
      <h3>Correct a stat line</h3>
      <label>Player
        <select required value={athlete} onChange={(e) => pick(e.target.value)}>
          <option value="">Choose…</option>
          {[...names].sort((a, b) => a[1].localeCompare(b[1])).map(([aid, n]) => <option key={aid} value={aid}>{n}</option>)}
        </select>
      </label>
      {athlete && (
        <div className="row">
          {stats.map((s) => (
            <label key={s}>{statLabel(s)}
              <input type="number" min={0} step={1} value={values[s] ?? 0}
                onChange={(e) => setValues({ ...values, [s]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
            </label>
          ))}
        </div>
      )}
      <button disabled={!athlete}>Save correction</button>
    </form>
  );
}
