import { Link, useParams, useSearchParams } from 'react-router';
import { Loading } from '../components/Loading';
import { rawScore } from '../../core/scoring';
import { loadCurrentSeason } from '../lib/stats';
import { loadTournamentStats, type StatRow } from '../lib/statsTable';
import { useLoad } from '../lib/useLoad';
import { StatTable, TournamentSwitch } from './StatTable';

/** One player, game by game, for the picked tournament (verified games only). */
export function PlayerPage() {
  const { athleteId = '' } = useParams();
  const wanted = useSearchParams()[0].get('t');
  const data = useLoad(async () => {
    const season = await loadCurrentSeason();
    return season && { season, wanted, ...await loadTournamentStats(season.id, wanted) };
  }, [wanted]);
  // Still showing the previous tournament while the picked one loads: treat as loading.
  const d = data.data && data.data.wanted !== wanted ? undefined : data.data;
  const back = <Link to={d?.stage ? `/stats?t=${d.stage.id}` : '/stats'}>← Stats</Link>;

  let body;
  if (data.error) body = <p className="error" role="alert">{data.error}</p>;
  else if (d === undefined) body = <Loading />;
  else if (d === null) body = <p>No season yet.</p>;
  else if (!d.stage) body = <p className="muted">No tournaments yet.</p>;
  else if (!d.names.has(athleteId)) body = <p className="muted">That player isn't in this season.</p>;
  else {
    const weights = d.season.settings.stat_weights;
    const rows: StatRow[] = d.games.filter((g) => g.verified_at).map((g) => {
      const counts = d.lines.find((l) => l.session_id === g.session_id && l.athlete_id === athleteId)?.stats ?? {};
      return { key: g.id, label: g.label, counts, points: rawScore(counts, weights) };
    });
    body = (
      <>
        <TournamentSwitch stages={d.stages} stage={d.stage} />
        <StatTable stats={Object.keys(weights)} rows={rows} first="Game" sortable={false} />
      </>
    );
  }
  return (
    <section className="page">
      <div className="head">
        <h1>{d?.names.get(athleteId) ?? 'Player'}</h1>
        {back}
      </div>
      {body}
    </section>
  );
}
