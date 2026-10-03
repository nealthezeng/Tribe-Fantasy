import { useState } from 'react';
import { ledgerRows, loadBackup, standingsRows, type LedgerLeague } from '../../lib/backup';
import { errorMessage } from '../../lib/errors';
import { downloadText, todayLocal, toCsv } from '../../lib/stats';
import { supabase } from '../../lib/supabase';
import { loadLeagueTournament } from '../../lib/tournament';

/** Manual backups: the free Supabase plan keeps none we can download. Run it weekly (ops checklist). */
export function BackupPanel({ seasonId }: { seasonId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<string>) {
    setBusy(label);
    setStatus(null);
    setError(null);
    try {
      setStatus(await action());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const backup = () => run('backup', async () => {
    const b = await loadBackup();
    downloadText(`tribe-backup-${todayLocal()}.json`, JSON.stringify(b));
    const n = Object.values(b.tables).reduce((sum, rows) => sum + rows.length, 0);
    return `Saved ${n} rows from ${Object.keys(b.tables).length} tables.`;
  });

  const leagues = async () => {
    const { data, error } = await supabase!.from('leagues')
      .select('id, name, memberships(team_name, credit_ledger(created_at, kind, amount, dollars, note, stages(name)))')
      .eq('season_id', seasonId).order('name');
    if (error) throw error;
    return (data ?? []) as unknown as (LedgerLeague & { id: string })[];
  };

  const ledger = () => run('ledger', async () => {
    const rows = ledgerRows(await leagues());
    downloadText(`tribe-ledger-${todayLocal()}.csv`, toCsv(rows));
    return `Saved ${rows.length - 1} ledger entries.`;
  });

  const standings = () => run('standings', async () => {
    const ls = await leagues();
    const years = await Promise.all(ls.map(async (l) => ({ name: l.name, year: await loadLeagueTournament(seasonId, l.id) })));
    downloadText(`tribe-standings-${todayLocal()}.csv`, toCsv(standingsRows(years)));
    return `Saved standings for ${ls.length} ${ls.length === 1 ? 'league' : 'leagues'}.`;
  });

  return (
    <div className="card">
      <h2>Backup</h2>
      <p className="muted">
        Download one every week and keep it private: it includes balances and injuries. Sealed bids and picks for
        games that haven't started aren't in it, since nobody can read those yet.
      </p>
      <div className="row">
        <button onClick={() => void backup()} disabled={busy !== null}>
          {busy === 'backup' ? 'Saving…' : 'Download backup'}
        </button>
      </div>
      <h3>For the treasurer</h3>
      <div className="row">
        <button className="secondary" onClick={() => void ledger()} disabled={busy !== null}>Ledger CSV</button>
        <button className="secondary" onClick={() => void standings()} disabled={busy !== null}>Standings CSV</button>
      </div>
      <p className="muted">Stats CSV: Stats tab, Download CSV.</p>
      {status && <p className="success" role="status">{status}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
