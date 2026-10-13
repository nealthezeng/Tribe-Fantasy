import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../components/Loading';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { useLoad } from '../lib/useLoad';
import { donateFor, loadMyTeams, TeamSwitch, useTeamChoice } from './HomePage';
import { balance, credits, entryLabel, type LedgerEntry } from '../lib/wallet';

const AMOUNTS = [5, 10, 20];
const THANKS_FOR = 7 * 24 * 3600_000; // a donation is thanked for a week, or until the next credit change
const usd = (d: number) => `$${Number.isInteger(d) ? d : d.toFixed(2)}`;
const TERMS = 'No cash value, no refunds, no guaranteed prize.';

export interface Donate { code: string; handle: string; creditsPerDollar: number }

/** The Credits page (account menu, or Get more credits while bidding): the team chosen on the League tab, same switch. */
export function CreditsPage() {
  const { session, loading } = useAuth();
  const uid = session?.user.id;
  const { data, error } = useLoad(() => loadMyTeams(uid), [uid]);
  const [m, pick] = useTeamChoice(data);
  if (loading) return <Loading />;
  if (!session) return <p><Link to="/login">Sign in</Link> to see your credits.</p>;
  return (
    <section className="page">
      <h1>Credits</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {!data && !error && <Loading />}
      {data?.length === 0 && <p><Link to="/leagues">Join a league</Link></p>}
      {data && data.length > 1 && <TeamSwitch teams={data} current={m} onPick={pick} />}
      {m && <Credits key={m.id} title={m.team_name} entries={m.credit_ledger} donate={donateFor(m)} />}
      {/* Only while the season takes donations, like the Donate box. */}
      {m?.leagues && donateFor(m) && <Donors seasonId={m.leagues.season_id} />}
    </section>
  );
}

/**
 * A team's credits (t224): the balance, a thank-you for a fresh donation, how to donate
 * more on Venmo with the team's code in the note (spec 2026-10-10 §6), the history, and the donation terms.
 */
export function Credits({ title = 'Credits', entries, donate, now = Date.now() }: {
  /** The team's name on the Credits page. */
  title?: string; entries: LedgerEntry[];
  /** null while the season takes no donations. */
  donate: Donate | null;
  now?: number;
}) {
  const total = balance(entries);
  const newestFirst = [...entries].sort((a, b) => b.id - a.id);
  const latest = newestFirst[0];
  const thanks = latest?.kind === 'donation' && now - Date.parse(latest.created_at) < THANKS_FOR ? latest : null;
  return (
    <article className="card money" aria-label={title}>
      <div className="head">
        <h2>{title}</h2>
        <p><span className="big">{total}</span> <span className="muted">{Math.abs(total) === 1 ? 'credit' : 'credits'}</span></p>
      </div>
      {thanks && <p className="success">Thanks for the {usd(Number(thanks.dollars))}! {credits(thanks.amount)} added.</p>}
      {donate ? <DonateForm {...donate} /> : <p className="muted"><small>{TERMS}</small></p>}
      <details className="section">
        <summary>Credit history</summary>
        <ul className="list">
          {newestFirst.length === 0 && <li className="muted">No credits yet.</li>}
          {newestFirst.map((e) => (
            <li key={e.id}>
              <span>{entryLabel(e)} <small>{new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></span>
              <strong className="num">{e.amount > 0 ? '+' : ''}{e.amount}</strong>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function DonateForm({ code, handle, creditsPerDollar }: Donate) {
  const [amount, setAmount] = useState(AMOUNTS[1]);
  const [copied, setCopied] = useState<string | null>(null);
  // Opens the Venmo app on a phone with the recipient, amount and note filled in; private so it stays off the public feed.
  const venmo = `https://venmo.com/?${new URLSearchParams({ txn: 'pay', audience: 'private', recipients: handle,
    amount: String(amount), note: `TribeF - ${code}` })}`;
  const copy = () => {
    // Cleared first, so a second copy changes the status again and gets announced again.
    const done = (ok: boolean) => {
      setCopied(null);
      requestAnimationFrame(() => setCopied(ok ? 'Copied. It goes in the Venmo note.' : `Couldn't copy. Type ${code} in the Venmo note.`));
    };
    if (!navigator.clipboard) return done(false);
    navigator.clipboard.writeText(code).then(() => done(true), () => done(false));
  };
  return (
    <div className="stack">
      <h3>Donate for more</h3>
      <div className="amounts" role="group" aria-label="Amount">
        {AMOUNTS.map((d) => (
          <button key={d} type="button" aria-pressed={amount === d} onClick={() => setAmount(d)}>
            {usd(d)}<small>{credits(d * creditsPerDollar)}</small>
          </button>
        ))}
      </div>
      <a className="button go" href={venmo} target="_blank" rel="noreferrer">
        Donate {usd(amount)} on Venmo<span className="sr-only"> (opens Venmo)</span>
      </a>
      {/* The terms sit right under the button: read before paying, not after (t233). */}
      <p className="muted"><small>Donation to the team fund. {TERMS}</small></p>
      <div className="team-code">
        <p>Venmo note: <strong>TribeF - <span className="code-chars">{code}</span></strong></p>
        <button type="button" className="secondary" onClick={copy}>Copy code</button>
      </div>
      <p className="muted" role="status">{copied}</p>
    </div>
  );
}

/** Everyone who donated this season, by name and total; a tick box shows you as Anonymous instead. */
export function Donors({ seasonId }: { seasonId: string }) {
  const board = useLoad(() => api.donationLeaderboard(seasonId), [seasonId]);
  const anon = useLoad(() => api.myDonateAnonymously(), []);
  // The box flips at once (before the save lands) and rolls back if the save fails, as in EmailReminders.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    const before = chosen;
    setError(null);
    setChosen(next);
    setSaving(true);
    try {
      await api.setDonateAnonymously(next);
      board.reload();
    } catch (err) {
      setChosen(before);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const failed = (load: { error: string | null; reload: () => void }) => (
    <p className="error" role="alert">
      {load.error} <button type="button" className="secondary" onClick={load.reload}>Try again</button>
    </p>
  );
  return (
    <article className="card" aria-label="Donors">
      <h2>Donors</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {board.error && !board.data && failed(board)}
      {!board.data && !board.error && <Loading />}
      {board.data?.length === 0 && <p className="muted">No donations yet.</p>}
      {board.data && board.data.length > 0 && (
        <ol className="list">
          {board.data.map((r, i) => (
            <li key={i}>
              <span>{i + 1}. {r.name ?? 'Anonymous'}{r.is_me && <small className="muted"> (you)</small>}</span>
              <strong className="num">{usd(Number(r.dollars))}</strong>
            </li>
          ))}
        </ol>
      )}
      {anon.error && anon.data === undefined && failed(anon)}
      <label className="check">
        <input type="checkbox" checked={chosen ?? anon.data ?? false} disabled={anon.data === undefined || saving}
          onChange={(e) => void toggle(e.target.checked)} />
        Show me as Anonymous
      </label>
    </article>
  );
}
