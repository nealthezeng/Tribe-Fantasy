import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { parseSettings } from '../../core/settings';
import { rawScore } from '../../core/scoring';
import { mergeTaps } from '../../core/taps';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { lockTime, SESSION_COLUMNS, sessionState, statLabel, type SessionRow } from '../lib/stats';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { rowToTap, type StatTapRow } from '../tally/queue';

interface LineRow { athlete_id: string; stats: Record<string, number> }
interface AttendanceRow { athlete_id: string; status: 'present' | 'absent' }

export function SessionPage() {
  const { id = '' } = useParams();
  const { session: auth, isKeeper, isAdmin } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const data = useLoad(async () => {
    const sess = await supabase!.from('sessions').select(SESSION_COLUMNS).eq('id', id).maybeSingle();
    if (sess.error) throw sess.error;
    if (!sess.data) return null;
    const s = sess.data as SessionRow;
    const [season, athletes, lines, attendance, taps, profiles] = await Promise.all([
      supabase!.from('seasons').select('settings').eq('id', s.season_id).single(),
      supabase!.from('athletes').select('id, name').eq('season_id', s.season_id),
      supabase!.from('stat_lines').select('athlete_id, stats').eq('session_id', id),
      supabase!.from('attendance').select('athlete_id, status').eq('session_id', id),
      // Keepers only (RLS returns nothing to members), so these two are harmless for everyone else.
      supabase!.from('stat_taps').select('id, athlete_id, stat, keeper_id, tapped_at, undoes').eq('session_id', id),
      supabase!.from('profiles').select('id, display_name'),
    ]);
    for (const r of [season, athletes, lines, attendance, taps, profiles]) if (r.error) throw r.error;
    return {
      session: s,
      settings: parseSettings(season.data!.settings),
      names: new Map((athletes.data ?? []).map((a: { id: string; name: string }) => [a.id, a.name])),
      lines: (lines.data ?? []) as LineRow[],
      attendance: (attendance.data ?? []) as AttendanceRow[],
      taps: ((taps.data ?? []) as StatTapRow[]).map(rowToTap),
      people: new Map((profiles.data ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name])),
    };
  }, [id]);

  const merge = useMemo(
    () => (data.data ? mergeTaps(data.data.taps, data.data.settings.tap_merge_seconds) : null),
    [data.data],
  );

  if (data.error) return <p className="error">{data.error}</p>;
  if (data.data === undefined) return <p>Loading…</p>;
  if (data.data === null) return <p>That session doesn't exist. <Link to="/stats">All sessions</Link></p>;
  const { session, settings, names, lines, attendance, taps, people } = data.data;
  const state = sessionState(session, settings.stat_lock_hours);
  const stats = Object.keys(settings.stat_weights);
  const name = (athleteId: string) => names.get(athleteId) ?? 'Unknown';
  const iTapped = taps.some((t) => t.keeperId === auth?.user.id);
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

  const verify = () =>
    run(() => api.verifySession(id, Object.entries(merge!.counts).map(([athlete_id, s]) => ({ athlete_id, stats: s }))));

  return (
    <section>
      <p><Link to="/stats">← All sessions</Link></p>
      <h1>{session.held_on} · {session.kind}{session.counts ? '' : ' (not counted)'}</h1>
      <p className="muted">
        {state === 'open' && 'Not verified yet.'}
        {state === 'verified' && `Verified — locks ${lockTime(session, settings.stat_lock_hours)}. A keeper can still reopen it until then.`}
        {state === 'locked' && 'Locked.'}
      </p>
      {error && <p className="error">{error}</p>}

      {state !== 'open' && (
        <div className="card">
          <h2>Stats</h2>
          <StatTable stats={stats} rows={lines.map((l) => ({ athlete: name(l.athlete_id), counts: l.stats, score: rawScore(l.stats, settings.stat_weights) }))} />
          {isKeeper && state === 'verified' && (
            <button disabled={busy} onClick={() => void run(() => api.reopenSession(id))}>Reopen for more tallying</button>
          )}
          {isAdmin && state === 'locked' && (
            <CorrectForm stats={stats} lines={lines} names={names} onSave={(athlete, s) => run(() => api.correctStatLine(id, athlete, s))} />
          )}
        </div>
      )}

      {isKeeper && state === 'open' && merge && (
        <div className="card">
          <h2>Merged totals (preview)</h2>
          <StatTable stats={stats} rows={Object.entries(merge.counts).map(([a, c]) => ({ athlete: name(a), counts: c, score: rawScore(c, settings.stat_weights) }))} />
          {merge.merged.length > 0 && (
            <>
              <h3>Counted once ({merge.merged.length})</h3>
              <ul>
                {merge.merged.map((g) => (
                  <li key={g.tapIds.join()}>{name(g.athleteId)} · {statLabel(g.stat)} · tapped by {g.tapIds.length} keepers</li>
                ))}
              </ul>
            </>
          )}
          {keepers.map((k) => (
            <details key={k}>
              <summary>Tallied by {people.get(k) ?? 'a keeper'}</summary>
              <StatTable stats={stats} rows={Object.entries(mergeTaps(taps.filter((t) => t.keeperId === k), 0).counts)
                .map(([a, c]) => ({ athlete: name(a), counts: c, score: rawScore(c, settings.stat_weights) }))} />
            </details>
          ))}
          {iTapped ? (
            <p className="muted">You tallied this session, so another keeper has to verify it.</p>
          ) : (
            <button disabled={busy} onClick={() => void verify()}>Verify these totals</button>
          )}
          <p><Link to="/tally">Back to tallying</Link></p>
        </div>
      )}

      <div className="card">
        <h2>Attendance</h2>
        <p>
          <strong>Present:</strong> {attendance.filter((a) => a.status === 'present').map((a) => name(a.athlete_id)).join(', ') || '—'}
        </p>
        <p>
          <strong>Absent:</strong> {attendance.filter((a) => a.status === 'absent').map((a) => name(a.athlete_id)).join(', ') || '—'}
        </p>
      </div>
    </section>
  );
}

function StatTable({ stats, rows }: {
  stats: string[]; rows: { athlete: string; counts: Record<string, number>; score: number }[];
}) {
  if (rows.length === 0) return <p>No stats.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr><th>Player</th>{stats.map((s) => <th key={s}>{statLabel(s)}</th>)}<th>Pts</th></tr>
        </thead>
        <tbody>
          {[...rows].sort((a, b) => a.athlete.localeCompare(b.athlete)).map((r) => (
            <tr key={r.athlete}>
              <td>{r.athlete}</td>
              {stats.map((s) => <td key={s}>{r.counts[s] ?? 0}</td>)}
              <td>{r.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
      <h3>Admin correction</h3>
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
      <p className="muted">Logged, and the week is rescored when scoring runs.</p>
    </form>
  );
}
