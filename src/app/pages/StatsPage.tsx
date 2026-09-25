import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { downloadText, loadCurrentSeason, SESSION_COLUMNS, sessionState, statLabel, toCsv, type SessionRow } from '../lib/stats';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';

const STATE_LABEL = { open: 'Not verified', verified: 'Verified', locked: 'Locked' } as const;

export function StatsPage() {
  const { isAdmin } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const data = useLoad(async () => {
    const season = await loadCurrentSeason();
    if (!season) return null;
    const { data, error } = await supabase!.from('sessions').select(SESSION_COLUMNS)
      .eq('season_id', season.id).order('held_on', { ascending: false });
    if (error) throw error;
    return { season, sessions: (data ?? []) as SessionRow[] };
  }, []);

  async function exportCsv() {
    if (!data.data) return;
    setError(null);
    try {
      const { season, sessions } = data.data;
      const [lines, athletes] = await Promise.all([
        supabase!.from('stat_lines').select('session_id, athlete_id, stats').in('session_id', sessions.map((s) => s.id)),
        supabase!.from('athletes').select('id, name').eq('season_id', season.id),
      ]);
      if (lines.error) throw lines.error;
      if (athletes.error) throw athletes.error;
      const names = new Map((athletes.data ?? []).map((a: { id: string; name: string }) => [a.id, a.name]));
      const byId = new Map(sessions.map((s) => [s.id, s]));
      const stats = Object.keys(season.settings.stat_weights);
      const rows = (lines.data ?? []).map((l: { session_id: string; athlete_id: string; stats: Record<string, number> }) => {
        const s = byId.get(l.session_id)!;
        return [s.held_on, s.kind, s.counts, names.get(l.athlete_id) ?? l.athlete_id, ...stats.map((k) => l.stats[k] ?? 0), s.verified_at ?? ''];
      });
      rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[3]).localeCompare(String(b[3])));
      const header = ['date', 'type', 'counts', 'player', ...stats.map(statLabel), 'verified_at'];
      downloadText(`${season.name}-stats.csv`, toCsv([header, ...rows]));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (data.error) return <p className="error">{data.error}</p>;
  if (data.data === undefined) return <p>Loading…</p>;
  if (data.data === null) return <p>No season yet.</p>;
  const { season, sessions } = data.data;
  return (
    <section>
      <h1>Stats · {season.name}</h1>
      {isAdmin && <button onClick={() => void exportCsv()}>Download CSV</button>}
      {error && <p className="error">{error}</p>}
      {sessions.length === 0 && <p>No sessions yet.</p>}
      <ul className="list">
        {sessions.map((s) => (
          <li key={s.id}>
            <Link to={`/stats/${s.id}`}>{s.held_on} · {s.kind}{s.counts ? '' : ' (not counted)'}</Link>
            <span className="muted">{STATE_LABEL[sessionState(s, season.settings.stat_lock_hours)]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
