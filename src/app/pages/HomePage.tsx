import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';
import { balance, entryLabel, LEDGER_COLUMNS, type LedgerEntry } from '../lib/wallet';

interface MembershipRow {
  id: string;
  team_name: string;
  leagues: { name: string; seasons: { name: string } | null } | null;
  credit_ledger: LedgerEntry[];
}

export function HomePage() {
  const { session, loading } = useAuth();
  const uid = session?.user.id;
  const { data, error } = useLoad(async () => {
    if (!supabase || !uid) return [] as MembershipRow[];
    const { data, error } = await supabase
      .from('memberships')
      .select(`id, team_name, leagues(name, seasons(name)), credit_ledger(${LEDGER_COLUMNS})`)
      .eq('user_id', uid);
    if (error) throw error;
    return (data ?? []) as unknown as MembershipRow[];
  }, [uid]);

  if (loading) return <p className="muted" role="status">Loading…</p>;
  if (!session) {
    return (
      <section className="card">
        <h1>Tribe Fantasy</h1>
        <p>A fantasy league for our team. Every dollar goes to the team fund.</p>
        <Link to="/login" className="button">Sign in</Link>
      </section>
    );
  }
  return (
    <section className="page">
      <h1>Your teams</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <p className="muted" role="status">Loading…</p>}
      {data && data.length === 0 && (
        <div className="card">
          <p>You're not in a league yet. Ask your league admin for an invite code.</p>
          <Link to="/join" className="button">Join with an invite code</Link>
        </div>
      )}
      {data?.map((m) => (
        <article key={m.id} className="card">
          <div>
            <h2>{m.team_name}</h2>
            <p className="muted">{m.leagues?.name} · {m.leagues?.seasons?.name}</p>
          </div>
          <p><span className="big">{balance(m.credit_ledger)}</span> credits</p>
          <Wallet entries={m.credit_ledger} />
        </article>
      ))}
      {data && data.length > 0 && <p><Link to="/join">Join another league</Link></p>}
    </section>
  );
}

function Wallet({ entries }: { entries: LedgerEntry[] }) {
  const newestFirst = [...entries].sort((a, b) => b.id - a.id);
  return (
    <details>
      <summary>Credit history</summary>
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
