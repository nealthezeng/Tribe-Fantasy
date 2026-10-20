import { Link, Navigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../components/Loading';
import { gameLabel } from '../lib/stats';
import { supabase } from '../lib/supabase';
import { loadLeagueTournament } from '../lib/tournament';
import { useLoad } from '../lib/useLoad';
import { loadMyTeams } from './HomePage';
import { Factor } from './TournamentCard';

interface TeamRow { league_id: string; removed_at: string | null; leagues: { name: string; season_id: string } | null }

/**
 * One team's page: its name, owner and just its players with each one's total multiplier for the team's next game.
 * Members of the league (current season) and staff only. RLS shows a member every membership of their leagues but
 * rosters only of their own, so anyone else gets the message, not an empty roster.
 */
export function TeamPage() {
  const { membershipId = '' } = useParams();
  const { session, loading, isAdmin, isKeeper } = useAuth();
  const uid = session?.user.id;
  const { data, error } = useLoad(async () => {
    const { data: row, error } = await supabase!.from('memberships').select('league_id, removed_at, leagues(name, season_id)')
      .eq('id', membershipId).maybeSingle();
    if (error) throw error;
    const team = row as unknown as TeamRow | null;
    if (!team?.leagues) return null;
    const allowed = isAdmin || isKeeper || (await loadMyTeams(uid)).some((t) => t.league_id === team.league_id);
    return allowed ? { team, leagues: team.leagues, y: await loadLeagueTournament(team.leagues.season_id, team.league_id) } : null;
  }, [membershipId, uid, isAdmin, isKeeper]);

  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  const back = <Link to="/leaderboards">← Leaderboards</Link>;
  if (error) return <section className="page"><p className="error" role="alert">{error}</p>{back}</section>;
  if (data === undefined) return <section className="page"><Loading /></section>;
  if (data === null) {
    return <section className="page"><p>You can only see teams in your league.</p><Link to="/leaderboards">Leaderboards</Link></section>;
  }

  const { team, leagues, y } = data;
  const { next, games } = y.result;
  const side = next?.sides.find((s) => s.membershipId === membershipId);
  const name = (id: string) => y.athlete.get(id) ?? 'A player';
  const owner = [y.owner.get(membershipId), leagues.name].filter(Boolean).join(' · ');
  return (
    <section className="page">
      <div className="head">
        <h1>{y.team.get(membershipId)}</h1>
        {back}
      </div>
      <small className="owner">{owner}</small>
      {!next ? <p className="muted">No tournament on. Players show once the next tournament's shares are settled.</p> : (
        <>
          <p className="muted">
            For {gameLabel(next.number, games.find((g) => g.game.stageId === next.stageId && g.game.number === next.number)?.game.opponent)}
            {' · '}{y.stage.get(next.stageId)}
          </p>
          {!side ? <p className="muted">{team.removed_at ? 'No players.' : 'No players this tournament.'}</p> : (
            <ul className="list">
              {[...side.players].sort((a, b) => name(a).localeCompare(name(b))).map((id) => (
                <li key={id}>
                  <span className="title">{name(id)}</span>
                  <Factor side={side} id={id} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
