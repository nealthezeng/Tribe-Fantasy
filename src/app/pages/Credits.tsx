import { useState } from 'react';
import { Link } from 'react-router';
import { balance, credits, entryLabel, type LedgerEntry } from '../lib/wallet';

const AMOUNTS = [5, 10, 20];
const THANKS_FOR = 7 * 24 * 3600_000; // a donation is thanked for a week, or until the next credit change
const usd = (d: number) => `$${Number.isInteger(d) ? d : d.toFixed(2)}`;

export interface Donate { code: string; handle: string; creditsPerDollar: number }

/**
 * A team's credits, always open under the matchup (t224): the balance, a thank-you for a fresh donation, how to donate
 * more on Venmo with the team's code in the note (spec 2026-10-10 §6), the history, and the donation terms.
 */
export function Credits({ id, entries, donate, now = Date.now() }: {
  id?: string; entries: LedgerEntry[];
  /** null while the season takes no donations. */
  donate: Donate | null;
  now?: number;
}) {
  const total = balance(entries);
  const newestFirst = [...entries].sort((a, b) => b.id - a.id);
  const latest = newestFirst[0];
  const thanks = latest?.kind === 'donation' && now - Date.parse(latest.created_at) < THANKS_FOR ? latest : null;
  return (
    <article className="card money" id={id} tabIndex={-1} aria-label="Credits">
      <div className="head">
        <h2>Credits</h2>
        <p><span className="big">{total}</span> <span className="muted">{Math.abs(total) === 1 ? 'credit' : 'credits'}</span></p>
      </div>
      {thanks && <p className="success">Thanks for the {usd(Number(thanks.dollars))}! {credits(thanks.amount)} added.</p>}
      {donate && <DonateForm {...donate} />}
      <details className="section">
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
      </details>
      <p className="muted"><small>
        {donate && `A donation to the team fund, to @${donate.handle} on Venmo. `}
        Credits have no cash value, can't be refunded, and there's no guaranteed prize.
      </small></p>
    </article>
  );
}

function DonateForm({ code, handle, creditsPerDollar }: Donate) {
  const [amount, setAmount] = useState(AMOUNTS[1]);
  const [copied, setCopied] = useState<string | null>(null);
  // Opens the Venmo app on a phone with the recipient, amount and note filled in; private so it stays off the public feed.
  const venmo = `https://venmo.com/?${new URLSearchParams({ txn: 'pay', audience: 'private', recipients: handle,
    amount: String(amount), note: `Tribe Fantasy ${code}` })}`;
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
      <div className="team-code">
        <p><small>Your team code</small><br /><span className="big">{code}</span></p>
        <button type="button" className="secondary" onClick={copy}>Copy code</button>
      </div>
      <p className="muted" role="status">{copied}</p>
      <p className="muted"><small>Keep {code} in the note so the credits reach your team, within about 10 minutes. <Link to="/rules">How it works</Link></small></p>
    </div>
  );
}
