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

  if (loading) return <p>Loading…</p>;
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
    <section>
      <h1>Your teams</h1>
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p>You're not in a league yet. <Link to="/join">Join with an invite code</Link>.</p>}
      <ul className="list">
        {data?.map((m) => (
          <li key={m.id}>
            <span><strong>{m.team_name}</strong> · {m.leagues?.name} ({m.leagues?.seasons?.name})</span>
            <Wallet entries={m.credit_ledger} />
          </li>
        ))}
      </ul>
      {data && data.length > 0 && <Link to="/join">Join another league</Link>}
    </section>
  );
}

function Wallet({ entries }: { entries: LedgerEntry[] }) {
  const newestFirst = [...entries].sort((a, b) => b.id - a.id);
  return (
    <details>
      <summary>{balance(entries)} credits</summary>
      <ul>
        {newestFirst.map((e) => (
          <li key={e.id}>
            {new Date(e.created_at).toLocaleDateString()} · {entryLabel(e)} · {e.amount > 0 ? '+' : ''}{e.amount}
          </li>
        ))}
      </ul>
      <p className="muted">
        Credits are a thank-you for supporting the team. They have no cash value and can't be refunded.
      </p>
    </details>
  );
}
