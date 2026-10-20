import { rosterOf, slotLive } from '../../../core/tournament';
import { Loading } from '../../components/Loading';
import { AUCTION_STAGE_COLUMNS, auctionPhase, pickPlayingStage, type AuctionStage } from '../../lib/auction';
import { gameLabel, todayLocal } from '../../lib/stats';
import { supabase } from '../../lib/supabase';
import { fetchAll, loadLeagueTournament, rowsOf, type LeagueTournament } from '../../lib/tournament';
import { useLoad } from '../../lib/useLoad';
import { credits } from '../../lib/wallet';

/** Everything the admin sees inside a league, sealed information included. The team editor (M14 T4) reads this too. */
export interface LeagueAdminData {
  leagueName: string;
  y: LeagueTournament;
  /** membershipId → the owner's display name ("Removed user" once the account is gone). */
  owners: Map<string, string>;
  balances: Map<string, number>;
  /** Buys made so far in a stage whose share buying is still open; empty otherwise. */
  sealedBuys: { membershipId: string; athleteId: string; amount: number }[];
  /** The season's opted-in players. */
  players: { id: string; name: string }[];
  /** The tournament whose rosters and next game are shown. */
  stageId: string | null;
  nextGame: number | null;
}

export async function loadLeagueAdminData(seasonId: string, leagueId: string): Promise<LeagueAdminData> {
  const sb = supabase!;
  const [y, leagues, members, stages, players] = await Promise.all([
    loadLeagueTournament(seasonId, leagueId),
    rowsOf<{ name: string }>(sb.from('leagues').select('name').eq('id', leagueId)),
    rowsOf<{ id: string; user_id: string | null }>(sb.from('memberships').select('id, user_id').eq('league_id', leagueId)),
    rowsOf<AuctionStage>(sb.from('stages').select(AUCTION_STAGE_COLUMNS).eq('season_id', seasonId)),
    rowsOf<{ id: string; name: string }>(sb.from('athletes').select('id, name').eq('season_id', seasonId).eq('opted_in', true).order('name')),
  ]);
  const userIds = members.flatMap((m) => (m.user_id ? [m.user_id] : []));
  const open = stages.find((s) => auctionPhase(s) === 'open');
  const [profiles, ledger, bids] = await Promise.all([
    rowsOf<{ id: string; display_name: string }>(userIds.length ? sb.from('profiles').select('id, display_name').in('id', userIds) : null),
    members.length
      ? fetchAll<{ membership_id: string; amount: number }>((from, to) => sb.from('credit_ledger').select('membership_id, amount')
        .in('membership_id', members.map((m) => m.id)).order('id').range(from, to))
      : [],
    rowsOf<{ membership_id: string; athlete_id: string; amount: number }>(open
      ? sb.from('bids').select('membership_id, athlete_id, amount').eq('stage_id', open.id).eq('league_id', leagueId) : null),
  ]);
  const names = new Map(profiles.map((p) => [p.id, p.display_name]));
  const balances = new Map(members.map((m) => [m.id, 0]));
  for (const e of ledger) balances.set(e.membership_id, (balances.get(e.membership_id) ?? 0) + e.amount);
  const next = y.result.next;
  return {
    leagueName: leagues[0]?.name ?? 'League',
    y,
    owners: new Map(members.map((m) => [m.id, m.user_id ? names.get(m.user_id) ?? 'Unknown' : 'Removed user'])),
    balances,
    sealedBuys: bids.map((b) => ({ membershipId: b.membership_id, athleteId: b.athlete_id, amount: b.amount })),
    players,
    stageId: next?.stageId ?? pickPlayingStage(stages, todayLocal())?.id ?? null,
    nextGame: next?.number ?? null,
  };
}

const record = (r: { wins: number; losses: number; ties: number }) => `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ''}`;

/** One league as its members see it, plus what is sealed from them: owners, balances, rosters, buys and next picks. */
export function LeagueBrowser({ seasonId, leagueId, onClose }: { seasonId: string; leagueId: string; onClose: () => void }) {
  const { data, error } = useLoad(() => loadLeagueAdminData(seasonId, leagueId), [seasonId, leagueId]);
  return (
    <div className="page">
      <div className="head">
        <h2>{data?.leagueName ?? 'League'}</h2>
        <button className="secondary" onClick={onClose}>Back</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <Loading />}
      {data && <Teams d={data} />}
    </div>
  );
}

function Teams({ d }: { d: LeagueAdminData }) {
  const { y, stageId, nextGame } = d;
  const athlete = (id: string) => y.athlete.get(id) ?? 'A player';
  const games = y.result.games.filter((g) => g.game.stageId === stageId);
  const gameName = (n: number) => gameLabel(n, games.find((g) => g.game.number === n)?.game.opponent);
  const next = y.result.next;
  // With no next game (between tournaments) every slot not yet ended still counts.
  const upTo = nextGame ?? Infinity;
  const roster = (m: string) => (stageId === null ? [] : rosterOf(y.input, m, stageId, upTo).map((id) => ({
    id,
    share: y.input.slots.filter((x) => x.stageId === stageId && x.membershipId === m && x.athleteId === id && slotLive(x, upTo))
      .reduce((sum, x) => sum + x.share, 0),
  })));
  const pairing = (g: (typeof games)[number]) => (g.matchups.length === 0 ? 'Not paired yet' : g.matchups.map((m) => (m.away
    ? `${y.team.get(m.home.membershipId)} vs ${y.team.get(m.away.membershipId)}` : `${y.team.get(m.home.membershipId)} has a bye`)).join(' · '));
  return (
    <>
      {d.sealedBuys.length > 0 && (
        <section className="card" aria-label="Buys so far">
          <h3>Buys so far</h3>
          <ul className="list">
            {d.sealedBuys.map((b) => (
              <li key={`${b.membershipId}:${b.athleteId}`}>
                <span>{y.team.get(b.membershipId) ?? 'A team'}</span>
                <span>{athlete(b.athleteId)}</span>
                <strong className="num">{credits(b.amount)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      {y.result.standings.map((s) => {
        const team = y.team.get(s.membershipId) ?? 'A team';
        const picked = next?.sides.find((x) => x.membershipId === s.membershipId)?.picked ?? [];
        return (
          <article key={s.membershipId} className="card team-card" aria-label={team}>
            <div className="who">
              <h3>{team}</h3>
              <small>{d.owners.get(s.membershipId)}</small>
            </div>
            <p className="head">
              <span>{s.tied ? 'T' : ''}{s.place} of {y.result.standings.length} · {record(s)}</span>
              <strong className="num">{credits(d.balances.get(s.membershipId) ?? 0)}</strong>
            </p>
            <ul className="list">
              {roster(s.membershipId).map((p) => <li key={p.id}>{athlete(p.id)} · {Math.round(p.share * 100)}%</li>)}
            </ul>
            {next && <p>{picked.length ? `Picks for ${gameName(next.number)}: ${picked.map(athlete).join(', ')}` : `No picks for ${gameName(next.number)}`}</p>}
          </article>
        );
      })}
      {games.length > 0 && (
        <section className="card" aria-label="Games">
          <h3>Games</h3>
          <ul className="list">
            {games.map((g) => <li key={g.game.id}>{gameName(g.game.number)} · {pairing(g)}</li>)}
          </ul>
        </section>
      )}
    </>
  );
}
