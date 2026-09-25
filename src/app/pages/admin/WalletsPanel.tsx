import { useState, type FormEvent } from 'react';
import { DEFAULT_SETTINGS } from '../../../core/settings';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { balance } from '../../lib/wallet';

interface LeagueRow {
  id: string;
  name: string;
  memberships: { id: string; team_name: string; credit_ledger: { amount: number }[] }[];
}
interface Team { id: string; label: string }

export function WalletsPanel({ seasonId }: { seasonId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = useLoad(async () => {
    const [season, leagues] = await Promise.all([
      supabase!.from('seasons').select('settings').eq('id', seasonId).single(),
      supabase!.from('leagues').select('id, name, memberships(id, team_name, credit_ledger(amount))')
        .eq('season_id', seasonId).order('name'),
    ]);
    if (season.error) throw season.error;
    if (leagues.error) throw leagues.error;
    const settings = season.data.settings as { donations_enabled?: unknown; credits_per_dollar?: unknown };
    return {
      donationsEnabled: settings.donations_enabled === true,
      creditsPerDollar: Number(settings.credits_per_dollar ?? DEFAULT_SETTINGS.credits_per_dollar),
      leagues: (leagues.data ?? []) as LeagueRow[],
    };
  }, [seasonId]);

  /** True when the action succeeded, so the form can clear itself. */
  async function run(action: () => Promise<string>): Promise<boolean> {
    setStatus(null);
    setError(null);
    try {
      setStatus(await action());
      data.reload();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  const teams: Team[] = (data.data?.leagues ?? []).flatMap((l) =>
    l.memberships.map((m) => ({ id: m.id, label: `${m.team_name} (${l.name})` })));

  return (
    <div className="card">
      <h2>Wallets</h2>
      {data.data?.leagues.map((l) => (
        <div key={l.id}>
          <h3>{l.name}</h3>
          <ul className="list">
            {l.memberships.map((m) => (
              <li key={m.id}><span>{m.team_name}</span><strong>{balance(m.credit_ledger)} credits</strong></li>
            ))}
          </ul>
        </div>
      ))}
      <CreditForm
        title="Adjust credits"
        help="Fixes a mistake. The ledger is never edited, so this adds a correcting entry. Use a negative number to take credits away."
        teams={teams}
        amountLabel="Credits (+/−)"
        step="1"
        onSubmit={(team, amount, note) => run(async () => {
          await api.adjustCredits(team.id, amount, note);
          return `Adjusted ${team.label} by ${amount}.`;
        })}
      />
      {data.data?.donationsEnabled && (
        <CreditForm
          title="Record a donation to the team"
          help={`Only after the treasurer has received the money through the official team channel. The app never
            holds or moves money. The donor gets ${data.data.creditsPerDollar} credits per dollar.`}
          teams={teams}
          amountLabel="Dollars donated to the team"
          step="0.01"
          onSubmit={(team, dollars, note) => run(async () => {
            await api.recordDonation(team.id, dollars, note);
            return `Recorded a $${dollars.toFixed(2)} donation to the team from ${team.label}.`;
          })}
        />
      )}
      {status && <p>{status}</p>}
      {(error || data.error) && <p className="error">{error ?? data.error}</p>}
    </div>
  );
}

function CreditForm({ title, help, teams, amountLabel, step, onSubmit }: {
  title: string;
  help: string;
  teams: Team[];
  amountLabel: string;
  step: string;
  onSubmit: (team: Team, amount: number, note: string) => Promise<boolean>;
}) {
  const [teamId, setTeamId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const team = teams.find((t) => t.id === teamId);
    if (!team) return;
    void onSubmit(team, Number(amount), note).then((ok) => { if (ok) { setAmount(''); setNote(''); } });
  }

  return (
    <form className="card" onSubmit={submit}>
      <h3>{title}</h3>
      <p className="muted">{help}</p>
      <div className="row">
        <label>Team
          <select required value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Choose…</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label>{amountLabel}<input type="number" required step={step} value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <label>Note<input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button>Save</button>
      </div>
    </form>
  );
}
