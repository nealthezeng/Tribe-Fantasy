import { Link, useParams, useSearchParams } from 'react-router';
import { Loading } from '../components/Loading';
import { rawScore } from '../../core/scoring';
import { loadCurrentSeason } from '../lib/stats';
import { loadTournamentStats, totals, type LineRow, type StatRow, type StatsGame } from '../lib/statsTable';
import { useLoad, usePoll } from '../lib/useLoad';
import { StatTable, TournamentSwitch } from './StatTable';

/** One player, game by game, for the picked tournament: verified games and their Total, plus any live game's unofficial line. */
export function PlayerPage() {
  const { athleteId = '' } = useParams();
  const wanted = useSearchParams()[0].get('t');
  const data = useLoad(async () => {
    const season = await loadCurrentSeason();
    return season && { season, wanted, ...await loadTournamentStats(season.id, wanted, { live: season.settings }) };
  }, [wanted]);
  // Still showing the previous tournament while the picked one loads: treat as loading.
  const d = data.data && data.data.wanted !== wanted ? undefined : data.data;
  usePoll(data.reload, !!d?.liveGames.length); // live numbers move
  const back = <Link to={d?.stage ? `/stats?t=${d.stage.id}` : '/stats'}>← Stats</Link>;

  // Nothing to show yet: the error, else loading. A failed reload (a poll, say) keeps the page under the error.
  let body;
  if (d === undefined) body = data.error ? <p className="error" role="alert">{data.error}</p> : <Loading />;
  else if (d === null) body = <p>No season yet.</p>;
  else if (!d.stage) body = <p className="muted">No tournaments yet.</p>;
  else if (!d.names.has(athleteId)) body = <p className="muted">That player isn't in this season.</p>;
  else {
    const weights = d.season.settings.stat_weights;
    const statsOf = (g: StatsGame, lines: LineRow[]) => lines.find((l) => l.session_id === g.session_id && l.athlete_id === athleteId)?.stats ?? {};
    const row = (g: StatsGame, label: string, counts: Record<string, number>): StatRow => ({ key: g.id, label, counts, points: rawScore(counts, weights) });
    const verified = d.games.filter((g) => g.verified_at);
    const rows = d.games.flatMap((g) => (g.verified_at ? [row(g, g.label, statsOf(g, d.lines))]
      : d.liveGames.includes(g.number) ? [row(g, `${g.label} · live, not counted yet`, statsOf(g, d.liveLines))] : []));
    // Verified games only, one per game (zeros where no line), so a Total shows whenever a verified game does.
    const [total] = totals(verified.map((g) => ({ athlete_id: athleteId, stats: statsOf(g, d.lines) })), new Map([[athleteId, 'Total']]), weights);
    body = (
      <>
        <TournamentSwitch stages={d.stages} stage={d.stage} />
        <StatTable stats={Object.keys(weights)} rows={rows} first="Game" sortable={false} total={total} />
      </>
    );
  }
  return (
    <section className="page">
      <div className="head">
        <h1>{d?.names.get(athleteId) ?? 'Player'}</h1>
        {back}
      </div>
      {d !== undefined && data.error && <p className="error" role="alert">{data.error}</p>}
      {body}
    </section>
  );
}
