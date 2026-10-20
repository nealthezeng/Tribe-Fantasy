import { Fragment, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../components/Loading';
import {
  countLeagues, fmt, loadLeagueTournament, loadSeasonStandings, mergeStandings, record, type LeagueTournament, type OverallStanding,
} from '../lib/tournament';
import { useLoad } from '../lib/useLoad';
import { AuctionCard } from './AuctionCard';
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
      {m?.leagues && <Board key={m.id} m={m} uid={uid!} />}
    </section>
  );
}

function Board({ m, uid }: { m: MembershipRow; uid: string }) {
  const { data: y, error } = useLoad(() => loadLeagueTournament(m.leagues!.season_id, m.league_id), [m.id]);
  if (!y) return error ? <p className="error" role="alert">{error}</p> : <Loading />;
  return (
    <>
      <Standings y={y} membershipId={m.id} leagueId={m.league_id} leagueName={m.leagues!.name} seasonId={m.leagues!.season_id} />
      <AuctionCard show="closed" membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues!.season_id} userId={uid}
        joinedAt={m.created_at} teamName={m.team_name} />
    </>
  );
}

/**
 * The league's standings as a ranked list. While the season has 2+ leagues, a toggle swaps in every team of the
 * season ranked together (t223, t226); that view loads on first use and reuses this league's data.
 */
function Standings({ y, membershipId, leagueId, leagueName, seasonId }: {
  y: LeagueTournament; membershipId: string; leagueId: string; leagueName: string; seasonId: string;
}) {
  const [all, setAll] = useState(false);
  const [wanted, setWanted] = useState(false); // stays true once asked for, so toggling back doesn't refetch
  const leagues = useLoad(() => countLeagues(seasonId), [seasonId]);
  const season = useLoad(async () => (wanted ? loadSeasonStandings(seasonId, { leagueId, y }) : undefined), [wanted, seasonId, leagueId]);
  const rows = all ? season.data : mergeStandings([{ name: leagueName, y }]);
  return (
    <article className="card" aria-label="Standings">
      <div className="head">
        <h2>Standings</h2>
        {(leagues.data ?? 0) > 1 && (
          <div className="segmented" role="group" aria-label="Standings for">
            <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>{leagueName}</button>
            <button type="button" aria-pressed={all} onClick={() => { setAll(true); setWanted(true); }}>All leagues</button>
          </div>
        )}
      </div>
      {rows ? <RankList key={String(all)} rows={rows} membershipId={membershipId} showLeague={all} />
        : season.error ? <p className="error" role="alert">{season.error}</p> : <Loading />}
    </article>
  );
}

/**
 * Ranked rows: place, team (league, owner and record under it), points; a leaderboard from day one, all tied at first (t239).
 * A long list shows the top 5 (with everyone tied with 5th) and your row, if that hides at least 4 teams.
 */
function RankList({ rows, membershipId, showLeague }: { rows: OverallStanding[]; membershipId: string; showLeague: boolean }) {
  const [open, setOpen] = useState(false);
  const top = rows.filter((r) => r.place <= (rows[Math.min(4, rows.length - 1)]?.place ?? 0) || r.membershipId === membershipId);
  const cut = !open && rows.length - top.length >= 4;
  const shown = cut ? top : rows;
  return (
    <>
      <ol className="ranks">
        {shown.map((r, i) => {
          const me = r.membershipId === membershipId;
          const skipped = i > 0 ? rows.indexOf(r) - rows.indexOf(shown[i - 1]) - 1 : 0;
          return (
            <Fragment key={r.membershipId}>
              {skipped > 0 && <li className="gap"><span aria-hidden="true">···</span><span className="sr-only">{skipped} more {skipped === 1 ? 'team' : 'teams'}</span></li>}
              <li aria-current={me ? 'true' : undefined}>
                <span className="rank">{r.tied ? 'T' : ''}{r.place}</span>
                <span className="who">
                  <strong>{r.team}{me && ' (you)'}</strong>
                  <small>{[showLeague && r.league, r.owner, record(r)].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="points">{fmt(r.points)}<span className="sr-only"> points</span></span>
              </li>
            </Fragment>
          );
        })}
      </ol>
      {cut && <button type="button" className="secondary" onClick={() => setOpen(true)}>Show all {rows.length} teams</button>}
    </>
  );
}
