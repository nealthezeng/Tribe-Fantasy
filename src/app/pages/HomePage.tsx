import { Fragment, type ReactNode } from 'react';
import { Loading } from '../components/Loading';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { AuctionCard } from './AuctionCard';
import { DonateBox } from './DonateBox';
import { LeagueLeave, ManageLeague } from './LeaguesPage';
import { TournamentCard } from './TournamentCard';
import { api } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { balance, entryLabel, LEDGER_COLUMNS, type LedgerEntry } from '../lib/wallet';
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

export function HomePage() {
  const { session, loading, isAdmin } = useAuth();
  const uid = session?.user.id;
  const { data, error, reload } = useLoad(async () => {
    if (!supabase || !uid) return [] as MembershipRow[];
    const { data, error } = await supabase
      .from('memberships')
      .select(`id, team_name, league_id, created_at, donation_code, leagues(name, season_id, seasons(name, settings)), credit_ledger(${LEDGER_COLUMNS})`)
      .eq('user_id', uid);
    if (error) throw error;
    return (data ?? []) as unknown as MembershipRow[];
  }, [uid]);
  // For Manage league (its creator, or an admin: older leagues have no creator) and the create limit (t215).
  const listed = useLoad(async () => (uid ? api.listLeagues() : undefined), [uid]);
  const manageable = (leagueId: string) => listed.data?.find((l) => l.id === leagueId && (l.is_creator || isAdmin));
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
      {data?.map((m) => {
        const subtitle = [m.leagues?.name, m.leagues?.seasons?.name].filter(Boolean).join(' · ');
        const wallet = <Wallet entries={m.credit_ledger} className="section" />;
        const team = (
          <article className="card">
            <div>
              <h2>{m.team_name}</h2>
              <p className="muted">{subtitle}</p>
            </div>
            <p><span className="big">{balance(m.credit_ledger)}</span> {Math.abs(balance(m.credit_ledger)) === 1 ? 'credit' : 'credits'}</p>
            {wallet}
          </article>
        );
        const mine = manageable(m.league_id);
        const changed = () => { reload(); listed.reload(); };
        const listing = listed.data?.find((l) => l.id === m.league_id);
        const leave = listing && <LeagueLeave membershipId={m.id} league={listing} onLeft={changed}
          donated={m.credit_ledger.some((e) => e.kind === 'donation')} />;
        const manage = mine ? <ManageLeague league={mine} onChanged={changed}>{leave}</ManageLeague> : leave;
        const s = m.leagues?.seasons?.settings;
        const donate = s?.donations_enabled === true && typeof s.venmo_handle === 'string'
          ? <DonateBox code={m.donation_code} handle={s.venmo_handle}
              creditsPerDollar={Number(s.credits_per_dollar ?? DEFAULT_SETTINGS.credits_per_dollar)} />
          : null;
        if (!m.leagues || !uid) return <Fragment key={m.id}>{team}{donate}{manage}</Fragment>;
        return (
          <Fragment key={m.id}>
            <TournamentCard membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id}
              teamName={m.team_name} subtitle={subtitle}>
              <AuctionCard membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id} userId={uid}
                joinedAt={m.created_at}
                teamName={m.team_name} wallet={wallet}
                team={<Wallet entries={m.credit_ledger} className="card"
                  summary={<>Credits <span className="big credits-sum">{balance(m.credit_ledger)}</span></>} />} />
            </TournamentCard>
            {donate}
            {manage}
          </Fragment>
        );
      })}
      {data && data.length > 0 && (
        <p className="meta">
          <Link to="/leagues" className="more">Join another league</Link>
          {canCreate && <Link to="/leagues/new" className="more">Create a league</Link>}
        </p>
      )}
    </section>
  );
}

/** Credit history, collapsed. Between auctions it's its own card with the balance in the summary. */
function Wallet({ entries, className, summary = 'Credit history' }: { entries: LedgerEntry[]; className: string; summary?: ReactNode }) {
  const newestFirst = [...entries].sort((a, b) => b.id - a.id);
  return (
    <details className={className}>
      <summary>{summary}</summary>
      <ul className="list">
        {newestFirst.length === 0 && <li className="muted">No credits yet.</li>}
        {newestFirst.map((e) => (
          <li key={e.id}>
            <span>{entryLabel(e)} <small>{new Date(e.created_at).toLocaleDateString()}</small></span>
            <strong className="num">{e.amount > 0 ? '+' : ''}{e.amount}</strong>
          </li>
        ))}
      </ul>
      <p className="muted">
        Credits are a thank-you for supporting the team. They have no cash value and can't be refunded.
      </p>
    </details>
  );
}
