import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import { downloadText, loadCurrentSeason, SESSION_COLUMNS, sessionState, sessionTitle, statLabel, toCsv, type SessionRow } from '../lib/stats';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';

export const STATE_PILL = {
  open: <span className="pill warn">Not verified</span>,
  verified: <span className="pill info">Verified</span>,
  locked: <span className="pill ok">Locked</span>,
} as const;

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
      const sessionIds = sessions.map((s) => s.id);
      const athletes = await supabase!.from('athletes').select('id, name').eq('season_id', season.id);
      if (athletes.error) throw athletes.error;

      // ponytail: PostgREST max_rows=1000, page-fetch until short page
      const PAGE = 1000;
      const allLines: Array<{ session_id: string; athlete_id: string; stats: Record<string, number> }> = [];
      for (let from = 0; ; from += PAGE) {
        const lines = await supabase!.from('stat_lines')
          .select('session_id, athlete_id, stats')
          .in('session_id', sessionIds)
          .order('session_id')
          .order('athlete_id')
          .range(from, from + PAGE - 1);
        if (lines.error) throw lines.error;
        if (!lines.data || lines.data.length === 0) break;
        allLines.push(...lines.data);
        if (lines.data.length < PAGE) break;
      }

      const names = new Map((athletes.data ?? []).map((a: { id: string; name: string }) => [a.id, a.name]));
      const byId = new Map(sessions.map((s) => [s.id, s]));
      const stats = Object.keys(season.settings.stat_weights);
      const rows = allLines.map((l: { session_id: string; athlete_id: string; stats: Record<string, number> }) => {
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

  if (data.error) return <p className="error" role="alert">{data.error}</p>;
  if (data.data === undefined) return <p className="muted" role="status">Loading…</p>;
  if (data.data === null) return <p>No season yet.</p>;
  const { season, sessions } = data.data;
  return (
    <section className="page">
      <div className="head">
        <h1>Stats <small>{season.name}</small></h1>
        {isAdmin && <button className="secondary" onClick={() => void exportCsv()}>Download CSV</button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {sessions.length === 0 && <p className="muted">No sessions yet. Stat keepers start one from Tally.</p>}
      <ul className="list">
        {sessions.map((s) => (
          <li key={s.id}>
            <Link className="title" to={`/stats/${s.id}`}>{sessionTitle(s)}</Link>
            <span className="meta">
              {!s.counts && <span className="pill">Not counted</span>}
              {STATE_PILL[sessionState(s, season.settings.stat_lock_hours)]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
