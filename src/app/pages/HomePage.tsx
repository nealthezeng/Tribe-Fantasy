import { Fragment, type ReactNode } from 'react';
import { Loading } from '../components/Loading';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { DiscMark } from '../components/Layout';
import { AuctionCard } from './AuctionCard';
import { TournamentCard } from './TournamentCard';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { balance, entryLabel, LEDGER_COLUMNS, type LedgerEntry } from '../lib/wallet';
import team800 from '../assets/team-800.jpg';
import team1600 from '../assets/team-1600.jpg';

interface MembershipRow {
  id: string;
  team_name: string;
  league_id: string;
  created_at: string;
  leagues: { name: string; season_id: string; seasons: { name: string } | null } | null;
  credit_ledger: LedgerEntry[];
}

export function HomePage() {
  const { session, loading } = useAuth();
  const uid = session?.user.id;
  const { data, error } = useLoad(async () => {
    if (!supabase || !uid) return [] as MembershipRow[];
    const { data, error } = await supabase
      .from('memberships')
      .select(`id, team_name, league_id, created_at, leagues(name, season_id, seasons(name)), credit_ledger(${LEDGER_COLUMNS})`)
      .eq('user_id', uid);
    if (error) throw error;
    return (data ?? []) as unknown as MembershipRow[];
  }, [uid]);

  if (loading) return <Loading />;
  if (!session) {
    return (
      <section className="hero">
        <DiscMark size={168} className="hero-disc" />
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
          <p>You're not in a league yet. Ask your league admin for an invite code.</p>
          <Link to="/join" className="button">Join with an invite code</Link>
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
        if (!m.leagues || !uid) return <Fragment key={m.id}>{team}</Fragment>;
        return (
          <TournamentCard key={m.id} membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id}
            teamName={m.team_name} subtitle={subtitle}>
            <AuctionCard membershipId={m.id} leagueId={m.league_id} seasonId={m.leagues.season_id} userId={uid}
              joinedAt={m.created_at}
              teamName={m.team_name} wallet={wallet}
              team={<Wallet entries={m.credit_ledger} className="card"
                summary={<>Credits <span className="big credits-sum">{balance(m.credit_ledger)}</span></>} />} />
          </TournamentCard>
        );
      })}
      {data && data.length > 0 && <p><Link to="/join" className="more">Join another league</Link></p>}
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
