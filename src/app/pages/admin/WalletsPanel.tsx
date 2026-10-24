import { useState, type FormEvent } from 'react';
import { Loading } from '../../components/Loading';
import { DEFAULT_SETTINGS } from '../../../core/settings';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { teamLabel } from '../../lib/tournament';
import { useLoad } from '../../lib/useLoad';
import { VenmoReceipts } from './VenmoReceipts';
import { balance, credits, entryLabel, LEDGER_COLUMNS, type LedgerEntry } from '../../lib/wallet';

interface LeagueRow {
  id: string;
  name: string;
  memberships: { id: string; team_name: string; removed_at: string | null; credit_ledger: LedgerEntry[] }[];
}
interface Wallet { id: string; team: string; league: string; entries: LedgerEntry[] }

/** Every team's credits as a row (P9 rule 1) that opens to its latest lines and the admin's credit forms for it. */
export function WalletsPanel({ seasonId }: { seasonId: string }) {
  const data = useLoad(async () => {
    const [season, leagues] = await Promise.all([
      supabase!.from('seasons').select('settings').eq('id', seasonId).single(),
      supabase!.from('leagues').select(`id, name, memberships(id, team_name, removed_at, credit_ledger(${LEDGER_COLUMNS}))`)
        .eq('season_id', seasonId).order('name'),
    ]);
    if (season.error) throw season.error;
    if (leagues.error) throw leagues.error;
    const settings = season.data.settings as { donations_enabled?: unknown; credits_per_dollar?: unknown };
    return {
      donationsEnabled: settings.donations_enabled === true,
      creditsPerDollar: Number(settings.credits_per_dollar ?? DEFAULT_SETTINGS.credits_per_dollar),
      // Teams A→Z within each league: the flat list has no league headings.
      wallets: ((leagues.data ?? []) as LeagueRow[]).flatMap((l) => [...l.memberships].sort((a, b) => a.team_name.localeCompare(b.team_name))
        .map((m): Wallet => ({ id: m.id, team: teamLabel(m), league: l.name, entries: m.credit_ledger }))),
    };
  }, [seasonId]);
  const d = data.data;

  return (
    <div className="card">
      <h2>Wallets</h2>
      {!d && !data.error && <Loading />}
      {d?.wallets.length === 0 && <p className="muted">No teams in this season yet.</p>}
      <ul className="list">
        {d?.wallets.map((w) => (
          <li key={w.id}>
            <details name="admin-wallet">
              <summary className="row-link">
                <span className="who"><b>{w.team}</b><small>{w.league}</small></span>
                <strong className="num">{credits(balance(w.entries))}</strong>
              </summary>
              <div className="stack">
                <ul className="list">
                  {w.entries.length === 0 && <li className="muted">No credits yet.</li>}
                  {[...w.entries].sort((a, b) => b.id - a.id).slice(0, 5).map((e) => (
                    <li key={e.id}>
                      <span>{entryLabel(e)} <small>{new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></span>
                      <strong className="num">{e.amount > 0 ? '+' : ''}{e.amount}</strong>
                    </li>
                  ))}
                </ul>
                <CreditForm team={w.team} kind="adjustment" amountLabel="Credits (+/−)" step="1" button="Save" onDone={data.reload}
                  submit={async (amount, note) => { await api.adjustCredits(w.id, amount, note); return `Adjusted ${w.team} by ${amount}.`; }} />
                {d.donationsEnabled && (
                  <>
                    <p className="muted">Only once the treasurer has the money. {d.creditsPerDollar} credits per dollar.</p>
                    <CreditForm team={w.team} kind="donation" amountLabel="Dollars donated to the team" step="0.01" button="Record donation" quiet onDone={data.reload}
                      submit={async (dollars, note) => {
                        await api.recordDonation(w.id, dollars, note);
                        return `Recorded a $${dollars.toFixed(2)} donation to the team from ${w.team}.`;
                      }} />
                  </>
                )}
              </div>
            </details>
          </li>
        ))}
      </ul>
      <VenmoReceipts />
      {data.error && <p className="error" role="alert">{data.error}</p>}
    </div>
  );
}

/**
 * Amount, note and its button for one team; what happened shows right under its own button. Each control's name says
 * the team, since several opened rows can show the same words.
 */
function CreditForm({ team, kind, amountLabel, step, button, quiet = false, submit, onDone }: {
  team: string;
  kind: 'adjustment' | 'donation';
  amountLabel: string;
  step: string;
  button: string;
  /** A secondary button, so an opened row has one gold button (P9 rule 2). */
  quiet?: boolean;
  /** Resolves to the success sentence. */
  submit: (amount: number, note: string) => Promise<string>;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      setStatus(await submit(Number(amount), note));
      setAmount('');
      setNote('');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="row" onSubmit={(e) => void save(e)}>
        <label>{amountLabel}
          <input type="number" required step={step} aria-label={`${amountLabel} for ${team}`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label>Note<input maxLength={200} aria-label={`Note on ${team}'s ${kind}`} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className={quiet ? 'secondary' : undefined} disabled={busy} aria-label={`${button} for ${team}`}>{button}</button>
      </form>
      {status && <p className="success" role="status">{status}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
