import { Fragment, useState } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { AthletesPanel } from './AthletesPanel';
import { LeaguesPanel } from './LeaguesPanel';
import { SeasonsPanel } from './SeasonsPanel';
import { SettingsEditor } from './SettingsEditor';
import { StaffPanel } from './StaffPanel';
import { StagesPanel } from './StagesPanel';
import { WalletsPanel } from './WalletsPanel';

// ponytail: buttons + scrollIntoView, not #anchors: the app uses hash routing.
const SECTIONS = [
  ['stages', 'Stages'], ['leagues', 'Leagues'], ['wallets', 'Wallets'],
  ['athletes', 'Athletes'], ['keepers', 'Keepers'], ['settings', 'Settings'],
] as const;

export function AdminPage() {
  const { isAdmin, loading } = useAuth();
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [ledgerVersion, setLedgerVersion] = useState(0);
  if (loading) return <p className="muted" role="status">Loading…</p>;
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <section className="page">
      <h1>Admin</h1>
      <SeasonsPanel selected={seasonId} onSelect={setSeasonId} />
      {seasonId ? (
        <Fragment key={seasonId}>
          <nav className="subnav" aria-label="Admin sections">
            {SECTIONS.map(([id, label]) => (
              <button key={id} type="button" onClick={() => document.querySelector(`[data-section="${id}"]`)?.scrollIntoView()}>
                {label}
              </button>
            ))}
          </nav>
          <div data-section="stages"><StagesPanel seasonId={seasonId} onGranted={() => setLedgerVersion((v) => v + 1)} /></div>
          <div data-section="leagues"><LeaguesPanel seasonId={seasonId} /></div>
          <div data-section="wallets"><WalletsPanel seasonId={seasonId} ledgerVersion={ledgerVersion} /></div>
          <div data-section="athletes"><AthletesPanel seasonId={seasonId} /></div>
        </Fragment>
      ) : (
        <p className="notice">Pick a season above to manage its stages, leagues, wallets and athletes.</p>
      )}
      <div data-section="keepers"><StaffPanel /></div>
      {seasonId && <div data-section="settings"><SettingsEditor key={seasonId} seasonId={seasonId} /></div>}
    </section>
  );
}
