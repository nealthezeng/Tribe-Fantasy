import { useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../components/Loading';
import { RankList } from '../components/RankList';
import {
  anyCounted, countLeagues, loadLeagueTournament, loadSeasonStandings, mergeStandings, pastTournaments, type LeagueTournament,
} from '../lib/tournament';
import { formatDay } from '../lib/stats';
import { useLoad } from '../lib/useLoad';
import { loadMyTeams, TeamSwitch, useTeamChoice, type MembershipRow } from './HomePage';

/** The Leaderboards tab: the standings of the team chosen on the League tab (same remembered choice and switch). */
export function LeaderboardsPage() {
  const { session, loading } = useAuth();
  const uid = session?.user.id;
  const { data, error } = useLoad(() => loadMyTeams(uid), [uid]);
  const [m, pick] = useTeamChoice(data);
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  return (
    <section className="page">
      <h1>Leaderboards</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <Loading />}
      {data?.length === 0 && <p><Link to="/leagues">Join a league</Link></p>}
      {data && data.length > 1 && <TeamSwitch teams={data} current={m} onPick={pick} />}
      {m?.leagues && <Board key={m.id} m={m} />}
    </section>
  );
}

function Board({ m }: { m: MembershipRow }) {
  const { data: y, error } = useLoad(() => loadLeagueTournament(m.leagues!.season_id, m.league_id), [m.id]);
  if (!y) return error ? <p className="error" role="alert">{error}</p> : <Loading />;
  return (
    <>
      <Standings y={y} membershipId={m.id} leagueId={m.league_id} leagueName={m.leagues!.name} seasonId={m.leagues!.season_id} />
      <PastTournaments y={y} membershipId={m.id} />
    </>
  );
}

/** Each finished tournament of the league, newest first, opening to its ranked teams (no per-game list). */
function PastTournaments({ y, membershipId }: { y: LeagueTournament; membershipId: string }) {
  const past = pastTournaments(y);
  if (past.length === 0) return null;
  return (
    <article className="card past" aria-label="Past tournaments">
      <h2>Past tournaments</h2>
      {past.map((t) => (
        <details key={t.stageId}>
          <summary>
            <strong>{t.name}</strong> <small>{formatDay(t.starts_on)} – {formatDay(t.ends_on)}</small>
            {t.waiting && <> <span className="pill warn">Waiting on stats</span></>}
          </summary>
          {t.rows.length === 0 ? <p className="muted">No results yet.</p>
            : <RankList rows={t.rows} membershipId={membershipId} showLeague={false} linkable={new Set(y.team.keys())} />}
        </details>
      ))}
    </article>
  );
}

/**
 * The league's standings as a ranked list. While the season has 2+ leagues, a toggle swaps in every team of the
 * season ranked together (t223, t226); that view loads on first use and reuses this league's data.
 */
function Standings({ y, membershipId, leagueId, leagueName, seasonId }: {
  y: LeagueTournament; membershipId: string; leagueId: string; leagueName: string; seasonId: string;
}) {
  const started = anyCounted(y);
  const [all, setAll] = useState(false);
  const [wanted, setWanted] = useState(false); // stays true once asked for, so toggling back doesn't refetch
  const leagues = useLoad(() => countLeagues(seasonId), [seasonId]);
  const season = useLoad(async () => (wanted ? loadSeasonStandings(seasonId, { leagueId, y }) : undefined), [wanted, seasonId, leagueId]);
  const rows = all ? season.data : mergeStandings([{ name: leagueName, y }]);
  return (
    <article className="card" aria-label="Standings">
      <div className="head">
        <h2>Standings</h2>
        {started && (leagues.data ?? 0) > 1 && (
          <div className="segmented" role="group" aria-label="Standings for">
            <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>{leagueName}</button>
            <button type="button" aria-pressed={all} onClick={() => { setAll(true); setWanted(true); }}>All leagues</button>
          </div>
        )}
      </div>
      {!started ? <p className="muted">Standings start after the first game.</p>
        : rows ? <RankList key={String(all)} rows={rows} membershipId={membershipId} showLeague={all} linkable={new Set(y.team.keys())} />
        : season.error ? <p className="error" role="alert">{season.error}</p> : <Loading />}
    </article>
  );
}
