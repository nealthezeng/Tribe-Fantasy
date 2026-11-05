import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { Loading } from '../components/Loading';
import { NameForm } from '../components/Layout';
import { AvatarPicker } from './AvatarPicker';
import { EmailReminders } from './EmailReminders';

/** Your own page: your avatar, name and email reminders. (Injury and attendance reports retired with Out marking: keepers mark Out on the tally.) */
export function MePage() {
  const { session, loading, displayName, avatar } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace />;
  return (
    <section className="page">
      <h1>Me</h1>
      {avatar !== undefined && <AvatarPicker key={session.user.id} uid={session.user.id} />}
      {/* No name yet means the profile is still loading (Layout asks a user with none before any page). */}
      {typeof displayName === 'string' && <div className="card"><NameForm current={displayName} /></div>}
      <EmailReminders uid={session.user.id} />
    </section>
  );
}
