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

/** Most-used first. Each tab mounts fresh, so Wallets always shows balances after a grant on Stages. */
const TABS = [
  ['stages', 'Stages'], ['leagues', 'Leagues'], ['wallets', 'Wallets'],
  ['athletes', 'Athletes'], ['keepers', 'Keepers'], ['settings', 'Settings'],
] as const;
type Tab = (typeof TABS)[number][0];

export function AdminPage() {
  const { isAdmin, loading } = useAuth();
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('stages');
  if (loading) return <p className="muted" role="status">Loading…</p>;
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <section className="page">
      <h1>Admin</h1>
      <SeasonsPanel selected={seasonId} onSelect={setSeasonId} />
      <nav className="subnav" aria-label="Admin sections">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>
      {tab === 'keepers' ? <StaffPanel /> : !seasonId ? (
        <p className="notice">Create a season above to manage its stages, leagues, wallets and athletes.</p>
      ) : (
        <Fragment key={seasonId}>
          {tab === 'stages' && <StagesPanel seasonId={seasonId} />}
          {tab === 'leagues' && <LeaguesPanel seasonId={seasonId} />}
          {tab === 'wallets' && <WalletsPanel seasonId={seasonId} />}
          {tab === 'athletes' && <AthletesPanel seasonId={seasonId} />}
          {tab === 'settings' && <SettingsEditor seasonId={seasonId} />}
        </Fragment>
      )}
    </section>
  );
}
