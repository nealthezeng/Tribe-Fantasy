import { useState } from 'react';
import { Loading } from '../components/Loading';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import {
  downloadText, loadCurrentSeason, SESSION_COLUMNS, statLabel, toCsv, type SessionRow,
} from '../lib/stats';
import { loadTournamentStats, totals } from '../lib/statsTable';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { StatTable, TournamentSwitch } from './StatTable';

export const STATE_PILL = {
  open: <span className="pill warn">Not verified</span>,
  verified: <span className="pill info">Verified</span>,
  locked: <span className="pill ok">Locked</span>,
} as const;

export function StatsPage() {
  const { isAdmin, isKeeper } = useAuth();
  const [params] = useSearchParams();
  const wanted = params.get('t');
  const [error, setError] = useState<string | null>(null);
  const data = useLoad(async () => {
    const season = await loadCurrentSeason();
    return season && { season, ...await loadTournamentStats(season.id, wanted) };
  }, [wanted]);
  const season = data.data?.season;

  async function exportCsv() {
    if (!season) return;
    setError(null);
    try {
      const found = await supabase!.from('sessions').select(SESSION_COLUMNS).eq('season_id', season.id).order('held_on', { ascending: false });
      if (found.error) throw found.error;
      const sessions = (found.data ?? []) as SessionRow[];
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

  const weights = season?.settings.stat_weights;
  const { stage, stages } = data.data ?? {};
  return (
    <section className="page">
      <div className="head">
        <h1>Stats {season && <small>{season.name}</small>}</h1>
        {isKeeper && (
          <div className="row">
            <Link to="/tally" className="button secondary">Tally</Link>
            {isAdmin && season && <button className="secondary" onClick={() => void exportCsv()}>Download CSV</button>}
          </div>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {data.error && <p className="error" role="alert">{data.error}</p>}
      {!data.error && data.data === undefined && <Loading />}
      {data.data === null && <p>No season yet.</p>}
      {data.data && !stage && <p className="muted">No tournaments yet.</p>}
      {data.data && stage && weights && (
        <>
          <TournamentSwitch stages={stages!} stage={stage} />
          {data.data.lines.length === 0
            ? <p className="muted">No stats yet for {stage.name}.</p>
            : <StatTable stats={Object.keys(weights)} rows={totals(data.data.lines, data.data.names, weights)} href={(r) => `/player/${r.key}?t=${stage.id}`} />}
        </>
      )}
    </section>
  );
}
