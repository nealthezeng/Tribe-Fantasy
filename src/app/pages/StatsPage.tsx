import { useMemo, useState } from 'react';
import { Loading } from '../components/Loading';
import { Link, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { errorMessage } from '../lib/errors';
import {
  downloadText, loadCurrentSeason, SESSION_COLUMNS, sessionState, statLabel, toCsv, type SessionRow,
} from '../lib/stats';
import { loadTournamentStats, totals, type StatsGame } from '../lib/statsTable';
import { supabase } from '../lib/supabase';
import { queuedSessions } from '../tally/queue';
import { useLoad } from '../lib/useLoad';
import { StatTable, TournamentSwitch } from './StatTable';

export const STATE_PILL = {
  open: <span className="pill warn">Not verified</span>,
  verified: <span className="pill info">Verified</span>,
  locked: <span className="pill ok">Locked</span>,
} as const;

export function StatsPage() {
  const { isAdmin, isKeeper, session } = useAuth();
  const userId = session?.user.id;
  const [params] = useSearchParams();
  const wanted = params.get('t');
  const [error, setError] = useState<string | null>(null);
  const data = useLoad(async () => {
    const season = await loadCurrentSeason();
    return season && { season, wanted, ...await loadTournamentStats(season.id, wanted) };
  }, [wanted]);
  // Keepers' taps still on this phone, so an unsaved game shows here and not only in the Tally picker.
  const unsaved = useMemo(
    () => new Map(isKeeper && userId ? queuedSessions(userId).map((q) => [q.sessionId, q.count]) : []),
    [isKeeper, userId],
  );
  // Still showing the previous tournament while the picked one loads: treat as loading.
  const loaded = data.data && data.data.wanted !== wanted ? undefined : data.data;
  const season = loaded?.season;

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
  const { stage, stages } = loaded ?? {};
  return (
    <section className="page">
      <div className="head">
        <h1>Stats {season && <small>{season.name}</small>}</h1>
        {isKeeper && <Link to="/tally" className="button secondary">Tally</Link>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {data.error && <p className="error" role="alert">{data.error}</p>}
      {!data.error && loaded === undefined && <Loading />}
      {loaded === null && <p>No season yet.</p>}
      {loaded && !stage && <p className="muted">No tournaments yet.</p>}
      {loaded && stage && weights && (
        <>
          <TournamentSwitch stages={stages!} stage={stage} />
          {loaded.lines.length === 0
            ? <p className="muted">No stats yet for {stage.name}.</p>
            : <StatTable stats={Object.keys(weights)} rows={totals(loaded.lines, loaded.names, weights)} href={(r) => `/player/${r.key}?t=${stage.id}`} />}
          <details className="card" open={isKeeper && loaded.games.some((g) => g.session_id && (!g.verified_at || unsaved.has(g.session_id)))}>
            <summary>All stats</summary>
            {loaded.games.length === 0 && <p className="muted">No games yet.</p>}
            <ul className="list">
              {loaded.games.map((g) => <GameItem key={g.id} g={g} lockHours={season!.settings.stat_lock_hours} keeper={isKeeper} unsaved={g.session_id ? unsaved.get(g.session_id) ?? 0 : 0} />)}
            </ul>
            {isAdmin && <button className="secondary" onClick={() => void exportCsv()}>Download CSV</button>}
          </details>
        </>
      )}
    </section>
  );
}

function GameItem({ g, lockHours, keeper, unsaved }: { g: StatsGame; lockHours: number; keeper: boolean; unsaved: number }) {
  const title = `Game ${g.number}${g.opponent ? ` vs ${g.opponent}` : ''}`;
  return (
    <li>
      <span className="meta">
        <span className="title">{g.session_id ? <Link to={`/stats/${g.session_id}`}>{title}</Link> : title}</span>
        {g.session_id ? STATE_PILL[sessionState(g, lockHours)] : <span className="muted">Not started</span>}
        {unsaved > 0 && <span className="pill warn">{unsaved} unsaved</span>}
      </span>
      {keeper && g.session_id && (!g.verified_at || unsaved > 0) && (
        <Link className={g.verified_at ? 'button secondary' : 'button'} to={`/tally?game=${g.session_id}`} aria-label={`${g.verified_at ? 'Open' : 'Tally'} ${title}`}>
          {g.verified_at ? 'Open' : 'Tally'}
        </Link>
      )}
    </li>
  );
}
