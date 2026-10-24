import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import type { GameOutcome } from '../../core/tournament';
import { useAuth } from '../auth/AuthProvider';
import { FactorHelp } from '../components/Help';
import { Loading } from '../components/Loading';
import { supabase } from '../lib/supabase';
import { currentGames, fmt, loadLeagueTournament, type LeagueTournament } from '../lib/tournament';
import { useLoad, usePoll } from '../lib/useLoad';
import { factorWords, gameName, statusWord } from '../lib/words';
import { loadMyTeams } from './HomePage';
import { Status } from './StatTable';

interface TeamRow { league_id: string; removed_at: string | null; leagues: { name: string; season_id: string } | null }

/**
 * One team's page: its name, owner, the game that matters now (its live game, else its next) and its players, each
 * with their share and tiredness for the next game in words. Members of the league (current season) and staff only.
 * Any league member can read every league's memberships, but rosters only of their own leagues (staff: all), so the
 * page gates on league membership.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function TeamPage() {
  const { membershipId = '' } = useParams();
  const { session, loading, isAdmin, isKeeper } = useAuth();
  const { key } = useLocation();
  const navigate = useNavigate();
  const uid = session?.user.id;
  const { data, error, reload } = useLoad(async () => {
    if (!UUID.test(membershipId)) return null; // a uuid column rejects anything else with a raw Postgres error
    const { data: row, error } = await supabase!.from('memberships').select('league_id, removed_at, leagues(name, season_id)')
      .eq('id', membershipId).maybeSingle();
    if (error) throw error;
    const team = row as unknown as TeamRow | null;
    if (!team?.leagues) return null;
    const allowed = isAdmin || isKeeper || (await loadMyTeams(uid)).some((t) => t.league_id === team.league_id);
    return allowed ? { team, leagues: team.leagues, y: await loadLeagueTournament(team.leagues.season_id, team.league_id, { live: true }) } : null;
  }, [membershipId, uid, isAdmin, isKeeper]);
  // A live game's numbers change under us: refresh every 15 s while the current tournament has one paired, as League does.
  usePoll(reload, !!data && currentGames(data.y).some((g) => g.status === 'live' && g.matchups.length > 0));

  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  // Opened from another page (League, Leaderboards, the pick card): Back returns there. Opened directly: Leaderboards.
  const back = key === 'default' ? <Link to="/leaderboards">← Leaderboards</Link>
    : <button type="button" className="linklike" onClick={() => navigate(-1)}>← Back</button>;
  // Nothing to show yet: the error, else loading. A failed reload (a poll, say) keeps the page under the error.
  if (data === undefined) return <section className="page">{error ? <><p className="error" role="alert">{error}</p>{back}</> : <Loading />}</section>;
  if (data === null) {
    return <section className="page"><p>You can only see teams in your league.</p><Link to="/leaderboards">Leaderboards</Link></section>;
  }

  const { team, leagues, y } = data;
  const { next, games } = y.result;
  const side = next?.sides.find((s) => s.membershipId === membershipId);
  const name = (id: string) => y.athlete.get(id) ?? 'A player';
  const owner = [y.owner.get(membershipId), leagues.name].filter(Boolean).join(' · ');
  // The game that matters now: the team's live game in the current tournament (X1), else its next (which may have no
  // game row yet), else none.
  const live = currentGames(y).find((g) => g.status === 'live' && g.matchups.some((m) => m.home.membershipId === membershipId || m.away?.membershipId === membershipId));
  const focus = live ?? games.find((g) => g.game.stageId === next?.stageId && g.game.number === next?.number);
  const number = live?.game.number ?? next?.number;
  return (
    <section className="page">
      <div className="head">
        <h1>{y.team.get(membershipId)}</h1>
        {back}
      </div>
      <small className="owner">{owner}</small>
      {error && <p className="error" role="alert">{error}</p>}
      {number !== undefined && <ul className="list"><li><GameRow y={y} membershipId={membershipId} number={number} g={focus} /></li></ul>}
      {!next ? <p className="muted">No tournament on. Players show once the next tournament's shares are settled.</p>
        : !side ? <p className="muted">{team.removed_at ? 'No players.' : 'No players this tournament.'}</p> : (
          <>
            <div className="head">
              <h2>Players</h2>
              <FactorHelp settings={y.settings} />
            </div>
            <ul className="list">
              {[...side.players].sort((a, b) => name(a).localeCompare(name(b))).map((id) => (
                <li key={id}>
                  <span className="title">{name(id)}</span>
                  <small>{factorWords(side, id, next.number, y.settings)}</small>
                </li>
              ))}
            </ul>
          </>
        )}
    </section>
  );
}

/**
 * The team's game on one row (rule 4), read like the League strip: "Game 2 vs Gimp Zeal", the scores "0.45 vs 1.35"
 * (live ones say unofficial), the real opponent once a keeper names it, then the status word. A started game (it has
 * a session) opens its game page (rule 1, with the chevron); one not started opens nothing.
 */
function GameRow({ y, membershipId, number, g }: { y: LeagueTournament; membershipId: string; number: number; g?: GameOutcome }) {
  const o = g && (y.unofficial.get(g.game.id) ?? g); // the numbers; the status word stays official
  const m = o?.matchups.find((x) => x.home.membershipId === membershipId || x.away?.membershipId === membershipId);
  const home = m?.home.membershipId === membershipId;
  const mine = m && (home ? m.home : m.away);
  const them = m && (home ? m.away : m.home); // null = bye
  const body = <>
    <span className="who">
      <b>{gameName(number, them && y.team.get(them.membershipId))}</b>
      {mine?.score != null && them?.score != null && <small>{fmt(mine.score)} vs {fmt(them.score)}{o !== g && ' · unofficial'}</small>}
      {them === null && <small>Bye</small>}
      {g?.game.opponent && <small>vs {g.game.opponent}</small>}
    </span>
    <Status word={g ? statusWord(g) : 'Not started'} />
  </>;
  return g?.game.sessionId ? <Link className="row-link" to={`/stats/${g.game.sessionId}`}>{body}</Link> : <div className="row-link">{body}</div>;
}
