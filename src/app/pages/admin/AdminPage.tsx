import { useState } from 'react';
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
  if (loading) return <p>Loading…</p>;
  if (!isAdmin) return <Navigate to="/" replace />;
  return (
    <section>
      <h1>Admin</h1>
      <SeasonsPanel selected={seasonId} onSelect={setSeasonId} />
      <StaffPanel />
      {seasonId && (
        <>
          <SettingsEditor key={seasonId} seasonId={seasonId} />
          <StagesPanel key={seasonId} seasonId={seasonId} />
          <LeaguesPanel key={seasonId} seasonId={seasonId} />
          <WalletsPanel key={seasonId} seasonId={seasonId} />
          <AthletesPanel key={seasonId} seasonId={seasonId} />
        </>
      )}
    </section>
  );
}
