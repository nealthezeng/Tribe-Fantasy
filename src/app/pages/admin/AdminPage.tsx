import { Fragment, useState } from 'react';
import { Loading } from '../../components/Loading';
import { Navigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { useInk } from '../../lib/useInk';
import { AthletesPanel } from './AthletesPanel';
import { BackupPanel } from './BackupPanel';
import { HistoryPanel } from './HistoryPanel';
import { LeaguesPanel } from './LeaguesPanel';
import { SeasonsPanel } from './SeasonsPanel';
import { SettingsEditor } from './SettingsEditor';
import { StagesPanel } from './StagesPanel';
import { UsersPanel } from './UsersPanel';
import { WalletsPanel } from './WalletsPanel';

/** Most-used first. Each tab mounts fresh, so Wallets always shows balances after a grant on Tournaments. */
const TABS = [
  ['stages', 'Tournaments'], ['leagues', 'Leagues'], ['users', 'Users'], ['wallets', 'Wallets'],
  ['athletes', 'Athletes'], ['settings', 'Settings'], ['history', 'History'], ['backup', 'Backup'],
] as const;
type Tab = (typeof TABS)[number][0];

export function AdminPage() {
  const { isAdmin, loading } = useAuth();
  const [seasonId, setSeasonId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('stages');
  const subnav = useInk<HTMLElement>(`${tab} ${loading} ${isAdmin}`);
  if (loading) return <Loading />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <section className="page">
      <h1>Admin</h1>
      <SeasonsPanel selected={seasonId} onSelect={setSeasonId} />
      <nav className="subnav" aria-label="Admin sections" ref={subnav}>
        {TABS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
        <span className="ink" aria-hidden="true" />
      </nav>
      {tab === 'users' ? <UsersPanel /> : !seasonId ? (
        <p className="notice">Create a season first.</p>
      ) : (
        <Fragment key={seasonId}>
          {tab === 'stages' && <StagesPanel seasonId={seasonId} />}
          {tab === 'leagues' && <LeaguesPanel seasonId={seasonId} />}
          {tab === 'wallets' && <WalletsPanel seasonId={seasonId} />}
          {tab === 'athletes' && <AthletesPanel seasonId={seasonId} />}
          {tab === 'settings' && <SettingsEditor seasonId={seasonId} />}
          {tab === 'history' && <HistoryPanel seasonId={seasonId} />}
          {tab === 'backup' && <BackupPanel seasonId={seasonId} />}
        </Fragment>
      )}
    </section>
  );
}
