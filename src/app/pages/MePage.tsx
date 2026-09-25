import { useState } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { SESSION_COLUMNS, sessionState, todayLocal, type SessionRow } from '../lib/stats';
import { parseSettings } from '../../core/settings';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';

interface MeData {
  athlete: { id: string; name: string };
  lockHours: number;
  sessions: SessionRow[];
  attendance: Map<string, 'present' | 'absent'>;
  injury: { confirmed_at: string | null } | null;
}

/** A player's own page: attendance for the last week of sessions, and injury reports. */
export function MePage() {
  const { session, loading } = useAuth();
  const uid = session?.user.id;
  const [error, setError] = useState<string | null>(null);
  const data = useLoad(async (): Promise<MeData | null> => {
    if (!uid) return null;
    // ponytail: newest linked athlete = current season; matches loadCurrentSeason's rule.
    const a = await supabase!.from('athletes').select('id, name, season_id, seasons(settings, created_at)')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (a.error) throw a.error;
    if (!a.data) return null;
    const since = todayLocal(new Date(Date.now() - 7 * 86_400_000));
    const [sessions, attendance, injury] = await Promise.all([
      supabase!.from('sessions').select(SESSION_COLUMNS).eq('season_id', a.data.season_id).gte('held_on', since)
        .order('held_on', { ascending: false }),
      supabase!.from('attendance').select('session_id, status').eq('athlete_id', a.data.id),
      supabase!.from('injuries').select('confirmed_at').eq('athlete_id', a.data.id).is('cleared_at', null).maybeSingle(),
    ]);
    for (const r of [sessions, attendance, injury]) if (r.error) throw r.error;
    const season = a.data.seasons as unknown as { settings: unknown } | null;
    return {
      athlete: { id: a.data.id, name: a.data.name },
      lockHours: parseSettings(season?.settings).stat_lock_hours,
      sessions: (sessions.data ?? []) as SessionRow[],
      attendance: new Map((attendance.data ?? []).map((r: { session_id: string; status: 'present' | 'absent' }) => [r.session_id, r.status])),
      injury: injury.data,
    };
  }, [uid]);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      data.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (loading) return <p>Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  if (data.error) return <p className="error">{data.error}</p>;
  if (data.data === undefined) return <p>Loading…</p>;
  if (data.data === null) {
    return <p>Your account isn't linked to a player yet. Ask an admin to link it.</p>;
  }
  const { athlete, lockHours, sessions, attendance, injury } = data.data;
  return (
    <section>
      <h1>{athlete.name}</h1>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <h2>Injury</h2>
        {!injury && (
          <>
            <p>Not injured.</p>
            <button onClick={() => void run(() => api.reportInjury(athlete.id))}>Report an injury</button>
          </>
        )}
        {injury && (
          <>
            <p>{injury.confirmed_at ? 'Injured (confirmed by a coach).' : 'Injury reported — waiting for a coach to confirm.'}</p>
            <button onClick={() => void run(() => api.clearInjury(athlete.id))}>I'm back</button>
          </>
        )}
      </div>
      <div className="card">
        <h2>Attendance</h2>
        {sessions.length === 0 && <p>No sessions in the last week.</p>}
        <ul className="list">
          {sessions.map((s) => {
            const status = attendance.get(s.id);
            const locked = sessionState(s, lockHours) === 'locked';
            return (
              <li key={s.id}>
                <span>{s.held_on} · {s.kind}</span>
                <span className="row">
                  {(['present', 'absent'] as const).map((st) => (
                    <button key={st} className={status === st ? '' : 'secondary'} disabled={locked}
                      onClick={() => void run(() => api.setAttendance(s.id, athlete.id, st))}>
                      {st === 'present' ? 'Present' : 'Absent'}
                    </button>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
