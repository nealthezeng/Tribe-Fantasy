import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { Loading } from '../../components/Loading';
import { errorMessage } from '../../lib/errors';
import { api, type Role, type UserRow } from '../../lib/rpc';
import { useLoad } from '../../lib/useLoad';
import { usd } from '../Credits';

export type { UserRow };

const ROLES: [Role, string][] = [['admin', 'admin'], ['stat_keeper', 'stat keeper'], ['treasurer', 'treasurer']];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const who = (u: UserRow) => u.display_name ?? u.email;

/** What removing this account touches, in full: nothing here can be undone. */
export function removeMessage(u: UserRow): string {
  const t = u.teams;
  const parts = [`Remove ${u.display_name ? `${u.display_name} (${u.email})` : u.email}?`];
  if (t.length === 1) {
    parts.push(`Their team ${t[0].team} leaves ${t[0].league}: it keeps the points it has, forfeits its remaining games and stops being paired.`);
  } else if (t.length > 1) {
    const names = t.map((m) => `${m.team} (${m.league})`);
    parts.push(`Their teams ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} leave their leagues: `
      + 'they keep the points they have, forfeit their remaining games and stop being paired.');
  }
  const d = u.donations;
  if (d.count > 0) parts.push(`Their ${d.count} ${d.count === 1 ? 'donation' : 'donations'} (${usd(d.dollars)}) ${d.count === 1 ? 'stays' : 'stay'} in the records.`);
  if (u.athlete) parts.push(`Their player profile ${u.athlete.name} stays, unlinked.`);
  parts.push("They can't sign in. This can't be undone.");
  return parts.join(' ');
}

/** Every account: roles, display name, and removal. */
export function UsersPanel() {
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const users = useLoad(() => api.listUsers(), []);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      users.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function rename(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    void run(async () => {
      await api.adminSetDisplayName(editing.id, editing.name);
      setEditing(null);
    });
  }

  function remove(u: UserRow) {
    if (window.confirm(removeMessage(u))) void run(() => api.adminRemoveUser(u.id));
  }

  const q = search.trim().toLowerCase();
  const shown = users.data?.filter((u) => !q || `${u.display_name ?? ''} ${u.email}`.toLowerCase().includes(q));
  return (
    <div className="card">
      <h2>Users <small>{users.data?.length ?? 0}</small></h2>
      <label>Search people<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      {(error || users.error) && <p className="error" role="alert">{error ?? users.error}</p>}
      {!users.data && !users.error && <Loading />}
      <ul className="list">
        {shown?.map((u) => (
          <li key={u.id}>
            {editing?.id === u.id ? (
              <form className="row" onSubmit={rename} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}>
                <input aria-label={`New name for ${who(u)}`} required maxLength={60} autoFocus value={editing.name}
                  onChange={(e) => setEditing({ id: u.id, name: e.target.value })} />
                <button>Save</button>
                <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <span className="meta">
                <span className="title">{who(u)}</span>
                {u.display_name && <span className="muted">{u.email}</span>}
                {u.teams.length > 0 && <span className="muted">{u.teams.map((m) => `${m.team} (${m.league})`).join(', ')}</span>}
              </span>
            )}
            {u.roles.length > 0 && <span className="meta">{u.roles.map((r) => <span key={r} className="pill info">{cap(r.replace('_', ' '))}</span>)}</span>}
            <div className="user-actions">
              {ROLES.map(([role, label]) => {
                const has = u.roles.includes(role);
                return (
                  <button key={role} className="secondary" aria-label={has ? `Remove ${label} from ${who(u)}` : `Make ${who(u)} ${label}`}
                    onClick={() => void run(() => (has ? api.revokeRole(u.id, role) : api.grantRole(u.id, role)))}>
                    {has ? `Remove ${label}` : `Make ${label}`}
                  </button>
                );
              })}
              {/* No profile yet: the name is asked at first sign-in, and admin_set_display_name would say NOT_FOUND. */}
              {u.display_name !== null && (
                <button className="secondary" aria-label={`Rename ${u.display_name}`} onClick={() => setEditing({ id: u.id, name: u.display_name ?? '' })}>Rename</button>
              )}
              <button className="secondary" aria-label={`Remove account ${who(u)}`} disabled={u.id === session?.user.id} onClick={() => remove(u)}>Remove account</button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
