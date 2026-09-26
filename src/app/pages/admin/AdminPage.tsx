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
          <StagesPanel seasonId={seasonId} onGranted={() => setLedgerVersion((v) => v + 1)} />
          <LeaguesPanel seasonId={seasonId} />
          <WalletsPanel seasonId={seasonId} ledgerVersion={ledgerVersion} />
          <AthletesPanel seasonId={seasonId} />
        </Fragment>
      ) : (
        <p className="notice">Pick a season above to manage its stages, leagues, wallets and athletes.</p>
      )}
      <StaffPanel />
      {seasonId && <SettingsEditor key={seasonId} seasonId={seasonId} />}
    </section>
  );
}
