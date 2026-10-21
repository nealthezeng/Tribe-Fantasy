import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { EmailReminders } from './EmailReminders';

/** Your own page: email reminders. (Injury and attendance reports retired with Out marking: keepers mark Out on the tally.) */
export function MePage() {
  const { session, loading } = useAuth();
  if (loading) return <p className="muted" role="status">Loading…</p>;
  if (!session) return <Navigate to="/login" replace />;
  return (
    <section className="page">
      <h1>Me</h1>
      <EmailReminders uid={session.user.id} />
    </section>
  );
}
