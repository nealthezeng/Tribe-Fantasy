import { useEffect, useRef, useState } from 'react';
import { Loading } from '../components/Loading';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { AuctionCard } from './AuctionCard';
import { LeagueLeave, ManageLeague } from './LeaguesPage';
import { TournamentCard } from './TournamentCard';
import { api, type LeagueListing } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { inSeason, loadCurrentSeason } from '../lib/stats';
import { loadNeedsYou } from '../lib/tournament';
import { useLoad } from '../lib/useLoad';
import { LEDGER_COLUMNS, type LedgerEntry } from '../lib/wallet';
import type { Donate } from './Credits';
import team800 from '../assets/team-800.jpg';
import team1600 from '../assets/team-1600.jpg';
import teamLogo from '../assets/team-logo.png';

export interface MembershipRow {
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

/** With 2+ teams the League tab and Credits page show one at a time (t229); the choice is shared and remembered on this device. */
const TEAM_KEY = 'league-team';
const savedTeam = () => { try { return localStorage.getItem(TEAM_KEY); } catch { return null; } };

/** The chosen team out of `teams` (the first if none chosen yet), and a way to choose another. */
export function useTeamChoice(teams: MembershipRow[] | undefined) {
  const [teamId, setTeamId] = useState(savedTeam);
  const pick = (id: string) => {
    setTeamId(id);
    try { localStorage.setItem(TEAM_KEY, id); } catch { /* remembered for this visit only */ }
  };
  return [teams?.find((x) => x.id === teamId) ?? teams?.[0], pick] as const;
}

/**
 * One button per team, named by its league; a gold dot marks a team that needs you. When such a team is scrolled out of
 * sight, that edge of the switch glows and pulses.
 */
export function TeamSwitch({ teams, current, onPick }: { teams: MembershipRow[]; current?: MembershipRow; onPick: (id: string) => void }) {
  const { data: needs } = useLoad(() => Promise.all(teams.map((m) => (m.leagues
    ? loadNeedsYou(m.id, m.league_id, m.leagues.season_id).catch(() => false) // no dot rather than no switch
    : false))), [teams.map((t) => t.id).join()]);
  const scroller = useRef<HTMLDivElement>(null);
  const [glow, setGlow] = useState({ left: false, right: false });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => {
      const box = el.getBoundingClientRect();
      const dots = [...el.querySelectorAll('.needs')].map((d) => d.getBoundingClientRect());
      const left = dots.some((d) => d.right <= box.left + 1);
      const right = dots.some((d) => d.left >= box.right - 1);
      setGlow((g) => (g.left === left && g.right === right ? g : { left, right }));
    };
    // A mouse wheel over the switch scrolls across the leagues; at either end the page scrolls as usual.
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // sideways trackpad swipes already scroll it
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // Firefox counts lines
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0 || (d < 0 && el.scrollLeft <= 0) || (d > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += d;
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('resize', check);
    return () => {
      el.removeEventListener('scroll', check);
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('resize', check);
    };
  }, [needs]);
  return (
    <div className={['team-switch-wrap', glow.left && 'glow-left', glow.right && 'glow-right'].filter(Boolean).join(' ')}>
      <div className="segmented team-switch" role="group" aria-label="League" ref={scroller}>
        {teams.map((t, i) => (
          <button key={t.id} type="button" aria-pressed={t.id === current?.id} onClick={() => onPick(t.id)}>
            {t.leagues?.name ?? t.team_name}
            {needs?.[i] && <span className="needs"><span className="sr-only"> (needs you)</span></span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Your teams in the current season, oldest first, each with its credit history. */
export async function loadMyTeams(uid: string | undefined): Promise<MembershipRow[]> {
  if (!supabase || !uid) return [];
  const { data, error } = await supabase
    .from('memberships')
    .select(`id, team_name, league_id, created_at, donation_code, leagues(name, season_id, seasons(name, settings)), credit_ledger(${LEDGER_COLUMNS})`)
    .eq('user_id', uid)
    .order('created_at');
  if (error) throw error;
  return inSeason((data ?? []) as unknown as MembershipRow[], (await loadCurrentSeason())?.id);
}

/** How to donate to this team, or null while its season takes no donations. */
export function donateFor(m: MembershipRow): Donate | null {
  const s = m.leagues?.seasons?.settings;
  return s?.donations_enabled === true && typeof s.venmo_handle === 'string'
    ? { code: m.donation_code, handle: s.venmo_handle, creditsPerDollar: Number(s.credits_per_dollar ?? DEFAULT_SETTINGS.credits_per_dollar) }
    : null;
}

export function HomePage() {
  const { session, loading, isAdmin } = useAuth();
  const uid = session?.user.id;
  const { data, error, reload } = useLoad(() => loadMyTeams(uid), [uid]);
  // For League settings (its creator, or an admin: older leagues have no creator) and the create limit (t215).
  const listed = useLoad(async () => (uid ? api.listLeagues() : undefined), [uid]);
  const canCreate = isAdmin || !listed.data?.some((l) => l.is_creator);
  const [m, pick] = useTeamChoice(data);

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

  return (
    <section className="page">
      {/* With a team, its matchup headline is the loud thing; the page title stays for screen readers. */}
      <h1 className={data?.length ? 'sr-only' : undefined}>Your teams</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <Loading />}
      {data && data.length === 0 && (
        <div className="card">
          <h2>Get started</h2>
          <div className="row">
            <Link to="/leagues" className="button">Join a league</Link>
            <Link to="/leagues/new" className="button secondary">Create a league</Link>
          </div>
        </div>
      )}
      {data && data.length > 1 && <TeamSwitch teams={data} current={m} onPick={pick} />}
      {m && <Team key={m.id} m={m} uid={uid!} />}
      {data && data.length > 0 && (
        <p className="meta">
          <Link to="/leagues" className="more">Join another league</Link>
          {canCreate && <Link to="/leagues/new" className="more">Create a league</Link>}
        </p>
      )}
      {m && <LeagueSettings key={`settings-${m.id}`} m={m} isAdmin={isAdmin} listed={listed.data} onChanged={() => { reload(); listed.reload(); }} />}
    </section>
  );
}

/** One team: matchup, what to do now, games. Credits have their own page (/credits). */
function Team({ m, uid }: { m: MembershipRow; uid: string }) {
  if (!m.leagues) return null;
  const subtitle = [m.leagues.name, m.leagues.seasons?.name].filter(Boolean).join(' · ');
  return (
    <TournamentCard membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id}
      teamName={m.team_name} subtitle={subtitle}>
      <AuctionCard show="open" membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id} userId={uid}
        joinedAt={m.created_at} teamName={m.team_name} getCredits={donateFor(m) !== null} />
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
