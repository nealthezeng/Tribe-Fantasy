import { useState, type FormEvent } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { Loading } from '../../components/Loading';
import { errorMessage } from '../../lib/errors';
import { api, type Role, type UserRow } from '../../lib/rpc';
import { useLoad } from '../../lib/useLoad';
import { usd } from '../Credits';

export type { UserRow };

const ROLES: Role[] = ['admin', 'stat_keeper', 'treasurer'];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const roleWord = (r: string) => cap(r.replace('_', ' '));
const who = (u: UserRow) => u.display_name ?? u.email;

/** What removing this account touches, in full: nothing here can be undone. */
export function removeMessage(u: UserRow): string {
  const t = u.teams;
  const parts = [`Remove ${u.display_name ? `${u.display_name} (${u.email})` : u.email}?`];
  // A removed team's side has no players from its removal on (core sideOf), and pairing leaves it out.
  if (t.length === 1) {
    parts.push(`Their team ${t[0].team} leaves ${t[0].league}: it keeps the points it has, scores 0 in any game it's paired in that hasn't started, and isn't paired again.`);
  } else if (t.length > 1) {
    const names = t.map((m) => `${m.team} (${m.league})`);
    parts.push(`Their teams ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} leave their leagues: `
      + "they keep the points they have, score 0 in any game they're paired in that hasn't started, and aren't paired again.");
  }
  const d = u.donations;
  if (d.count > 0) parts.push(`Their ${d.count} ${d.count === 1 ? 'donation' : 'donations'} (${usd(d.dollars)}) ${d.count === 1 ? 'stays' : 'stay'} in the records.`);
  if (u.athlete) parts.push(`Their player profile ${u.athlete.name} stays, unlinked.`);
  if (u.roles.length > 0) parts.push(`Their roles (${u.roles.map(roleWord).join(', ')}) go.`);
  if (t.length > 0) parts.push('Any buys in open share buying are cancelled.');
  parts.push("They can't sign in. This can't be undone.");
  return parts.join(' ');
}

/** Every account, one row each (P9 rule 1): the row opens its roles, name and removal. */
export function UsersPanel() {
  const [search, setSearch] = useState('');
  const users = useLoad(() => api.listUsers(), []);

  const q = search.trim().toLowerCase();
  const shown = users.data?.filter((u) => !q || `${u.display_name ?? ''} ${u.email}`.toLowerCase().includes(q));
  return (
    <div className="card">
      <h2>Accounts <small>{users.data?.length ?? 0}</small></h2>
      <label>Search people<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
      {users.error && <p className="error" role="alert">{users.error}</p>}
      {!users.data && !users.error && <Loading />}
      <ul className="list">
        {shown?.map((u) => <Person key={u.id} u={u} reload={users.reload} />)}
      </ul>
    </div>
  );
}

function Person({ u, reload }: { u: UserRow; reload: () => Promise<unknown> }) {
  const { session } = useAuth();
  const [name, setName] = useState(u.display_name ?? '');
  const [error, setError] = useState<string | null>(null);
  // An action in flight, until its reload lands: the role boxes wait, so a box that snaps back isn't tapped twice.
  const [busy, setBusy] = useState(false);
  const line = u.roles.length > 0 ? u.roles.map(roleWord).join(', ') : u.teams.map((m) => `${m.team} · ${m.league}`).join(', ');

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function toggle(role: Role, has: boolean) {
    if (busy) return; // the disabled box already stops a tap; this stops a click a test (or a script) sends anyway
    // Unticking your own admin has no undo: once you aren't an admin you can't give it back.
    if (has && role === 'admin' && u.id === session?.user.id
      && !window.confirm("Remove your own admin role? You lose Admin right away and can't give it back yourself; another admin has to.")) return;
    void run(() => (has ? api.revokeRole(u.id, role) : api.grantRole(u.id, role)));
  }

  function rename(e: FormEvent) {
    e.preventDefault();
    void run(() => api.adminSetDisplayName(u.id, name));
  }

  function remove() {
    if (window.confirm(removeMessage(u))) void run(() => api.adminRemoveUser(u.id));
  }

  return (
    <li>
      <details name="account">
        <summary className="row-link"><span className="who"><b>{who(u)}</b>{line && <small>{line}</small>}</span></summary>
        <div className="stack">
          {u.display_name && <p className="muted">{u.email}</p>}
          <div className="stack" role="group" aria-label="Roles">
            {ROLES.map((role) => {
              const has = u.roles.includes(role);
              return (
                <label key={role} className="check">
                  <input type="checkbox" checked={has} disabled={busy} onChange={() => toggle(role, has)} />
                  {roleWord(role)}
                </label>
              );
            })}
          </div>
          {/* No profile yet: the name is asked at first sign-in, and admin_set_display_name would say NOT_FOUND. */}
          {u.display_name !== null && (
            <form className="row" onSubmit={rename}>
              <label>Name<input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
              <button className="secondary">Save name</button>
            </form>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="danger-link" aria-label={`Remove account ${who(u)}`} disabled={u.id === session?.user.id} onClick={remove}>Remove account</button>
        </div>
      </details>
    </li>
  );
}
