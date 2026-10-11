import { useState } from 'react';
import { Loading } from '../components/Loading';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { AuctionCard } from './AuctionCard';
import { Credits } from './Credits';
import { LeagueLeave, ManageLeague } from './LeaguesPage';
import { TournamentCard } from './TournamentCard';
import { api, type LeagueListing } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { LEDGER_COLUMNS, type LedgerEntry } from '../lib/wallet';
import team800 from '../assets/team-800.jpg';
import team1600 from '../assets/team-1600.jpg';
import teamLogo from '../assets/team-logo.png';

interface MembershipRow {
  id: string;
  team_name: string;
  league_id: string;
  created_at: string;
  donation_code: string;
  leagues: {
    name: string; season_id: string;
    seasons: { name: string; settings: { donations_enabled?: unknown; venmo_handle?: unknown; credits_per_dollar?: unknown } } | null;
  } | null;
  credit_ledger: LedgerEntry[];
}

/** With 2+ teams the League tab shows one at a time (t229); the choice is remembered on this device. */
const TEAM_KEY = 'league-team';
const savedTeam = () => { try { return localStorage.getItem(TEAM_KEY); } catch { return null; } };

export function HomePage() {
  const { session, loading, isAdmin } = useAuth();
  const uid = session?.user.id;
  const [teamId, setTeamId] = useState(savedTeam);
  const { data, error, reload } = useLoad(async () => {
    if (!supabase || !uid) return [] as MembershipRow[];
    const { data, error } = await supabase
      .from('memberships')
      .select(`id, team_name, league_id, created_at, donation_code, leagues(name, season_id, seasons(name, settings)), credit_ledger(${LEDGER_COLUMNS})`)
      .eq('user_id', uid)
      .order('created_at');
    if (error) throw error;
    return (data ?? []) as unknown as MembershipRow[];
  }, [uid]);
  // For League settings (its creator, or an admin: older leagues have no creator) and the create limit (t215).
  const listed = useLoad(async () => (uid ? api.listLeagues() : undefined), [uid]);
  const canCreate = isAdmin || !listed.data?.some((l) => l.is_creator);

  if (loading) return <Loading />;
  if (!session) {
    return (
      <section className="hero">
        <figure className="hero-photo">
          <img src={team1600} srcSet={`${team800} 800w, ${team1600} 1600w`} sizes="(max-width: 600px) 100vw, 720px"
            width={1600} height={471} alt="The team on the field after a tournament, with family, friends and alumni" />
          <figcaption>Thank you to the families, friends and alumni who came out to cheer us on and squeezed into this photo.</figcaption>
        </figure>
        <h1>Tribe Fantasy</h1>
        <p>A fantasy league for our team. Every dollar goes to the team fund.</p>
        <div className="row">
          <Link to="/login" className="button">Sign in</Link>
          <Link to="/rules" className="button secondary">How it works</Link>
        </div>
        <img className="hero-logo" src={teamLogo} width={168} height={168} alt="A Tribe Called Tech" />
      </section>
    );
  }

  const m = data?.find((x) => x.id === teamId) ?? data?.[0];
  const pick = (id: string) => {
    setTeamId(id);
    try { localStorage.setItem(TEAM_KEY, id); } catch { /* remembered for this visit only */ }
  };
  return (
    <section className="page">
      {/* With a team, its matchup headline is the loud thing; the page title stays for screen readers. */}
      <h1 className={data?.length ? 'sr-only' : undefined}>Your teams</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <Loading />}
      {data && data.length === 0 && (
        <div className="card">
          <h2>Get started</h2>
          <p>Join a league someone has already made, or create your own and invite people.</p>
          <div className="row">
            <Link to="/leagues" className="button">Join a league</Link>
            <Link to="/leagues/new" className="button secondary">Create a league</Link>
          </div>
        </div>
      )}
      {data && data.length > 1 && (
        <div className="segmented team-switch" role="group" aria-label="Team">
          {data.map((t) => (
            <button key={t.id} type="button" aria-pressed={t.id === m?.id} onClick={() => pick(t.id)}>{t.team_name}</button>
          ))}
        </div>
      )}
      {m && <Team key={m.id} m={m} uid={uid!} />}
      {data && data.length > 0 && (
        <p className="meta">
          <Link to="/leagues" className="more">Join another league</Link>
          {canCreate && <Link to="/leagues/new" className="more">Create a league</Link>}
        </p>
      )}
      {m && <LeagueSettings key={m.id} m={m} isAdmin={isAdmin} listed={listed.data} onChanged={() => { reload(); listed.reload(); }} />}
    </section>
  );
}

/** One team: matchup, what to do now, Credits, standings, games. */
function Team({ m, uid }: { m: MembershipRow; uid: string }) {
  const subtitle = [m.leagues?.name, m.leagues?.seasons?.name].filter(Boolean).join(' · ');
  const s = m.leagues?.seasons?.settings;
  const donate = s?.donations_enabled === true && typeof s.venmo_handle === 'string'
    ? { code: m.donation_code, handle: s.venmo_handle, creditsPerDollar: Number(s.credits_per_dollar ?? DEFAULT_SETTINGS.credits_per_dollar) }
    : null;
  const creditsId = `credits-${m.id}`;
  const money = <Credits id={creditsId} entries={m.credit_ledger} donate={donate} />;
  if (!m.leagues) return money;
  return (
    <TournamentCard membershipId={m.id} leagueId={m.league_id} leagueName={m.leagues.name} seasonId={m.leagues.season_id}
      teamName={m.team_name} subtitle={subtitle} money={money}>
      <AuctionCard membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id} userId={uid}
        joinedAt={m.created_at} teamName={m.team_name} creditsId={donate ? creditsId : undefined} />
    </TournamentCard>
  );
}

/** Rename / password / delete for the league's creator or an admin, and Leave: rare, so folded at the bottom (t227). */
function LeagueSettings({ m, isAdmin, listed, onChanged }: { m: MembershipRow; isAdmin: boolean; listed?: LeagueListing[]; onChanged: () => void }) {
  const listing = listed?.find((l) => l.id === m.league_id);
  if (!listing) return null;
  const donated = m.credit_ledger.some((e) => e.kind === 'donation');
  const leave = donated ? null : <LeagueLeave membershipId={m.id} league={listing} onLeft={onChanged} />;
  const manage = listing.is_creator || isAdmin;
  if (!manage && !leave) return null;
  return (
    <details className="settings">
      <summary>League settings</summary>
      {manage ? <ManageLeague league={listing} onChanged={onChanged}>{leave}</ManageLeague> : leave}
    </details>
  );
}
