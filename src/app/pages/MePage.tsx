import { useState } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { EmailReminders } from './EmailReminders';
import { api } from '../lib/rpc';
import { gameTitles, SESSION_COLUMNS, sessionState, titleOf, todayLocal, type SessionRow } from '../lib/stats';
import { parseSettings } from '../../core/settings';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';

interface MeData {
  athlete: { id: string; name: string };
  lockHours: number;
  sessions: SessionRow[];
  /** "Game 3 · Fall Beta" per session that is a game. */
  games: Map<string, string>;
  attendance: Map<string, 'present' | 'absent'>;
  injury: { confirmed_at: string | null } | null;
}

/** Your own page: email reminders for everyone; attendance and injury reports for linked players. */
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
      games: await gameTitles(((sessions.data ?? []) as SessionRow[]).map((s) => s.id)),
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

  if (loading) return <p className="muted" role="status">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  if (data.error) {
    return (
      <section className="page">
        <h1>Me</h1>
        <EmailReminders uid={uid!} />
        <p className="error" role="alert">{data.error}</p>
      </section>
    );
  }
  if (data.data === undefined) return <p className="muted" role="status">Loading…</p>;
  if (data.data === null) {
    return (
      <section className="page">
        <h1>Me</h1>
        <EmailReminders uid={uid!} />
        <div className="card">
          <p>Your account isn't linked to a player yet. Ask an admin to link it.</p>
        </div>
      </section>
    );
  }
  const { athlete, lockHours, sessions, games, attendance, injury } = data.data;
  return (
    <section className="page">
      <h1>{athlete.name}</h1>
      {error && <p className="error" role="alert">{error}</p>}
      <EmailReminders uid={uid!} />
      <div className="card">
        <div className="head">
          <h2>Injury</h2>
          {!injury && <span className="pill ok">Healthy</span>}
          {injury && (injury.confirmed_at
            ? <span className="pill bad">Injured · confirmed</span>
            : <span className="pill warn">Reported · waiting for a coach</span>)}
        </div>
        {!injury && (
          <button className="secondary" onClick={() => void run(() => api.reportInjury(athlete.id))}>Report an injury</button>
        )}
        {injury && (
          <button onClick={() => void run(() => api.clearInjury(athlete.id))}>I'm back</button>
        )}
      </div>
      <div className="card">
        <h2>Attendance</h2>
        <p className="muted">Games from the last week. You can change your answer until {lockHours} hours after a game's stats are verified.</p>
        {sessions.length === 0 && <p>No games in the last week.</p>}
        <ul className="list">
          {sessions.map((s) => {
            const status = attendance.get(s.id);
            const locked = sessionState(s, lockHours) === 'locked';
            return (
              <li key={s.id}>
                <span className="title">{titleOf(s, games)}</span>
                <span className="segmented" role="group" aria-label={`Attendance for ${titleOf(s, games)}`}>
                  {(['present', 'absent'] as const).map((st) => (
                    <button key={st} aria-pressed={status === st} disabled={locked}
                      onClick={() => void run(() => api.setAttendance(s.id, athlete.id, st))}>
                      {st === 'present' ? 'Present' : 'Absent'}{status === st ? ' ✓' : ''}
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
