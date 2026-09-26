import { useState } from 'react';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

interface Person { id: string; display_name: string; keeper: boolean }

/** Coaches get stat_keeper (tally + verify), never admin. */
export function StaffPanel() {
  const [error, setError] = useState<string | null>(null);
  const people = useLoad(async () => {
    const [profiles, roles] = await Promise.all([
      supabase!.from('profiles').select('id, display_name').order('display_name'),
      supabase!.from('user_roles').select('user_id').eq('role', 'stat_keeper'),
    ]);
    if (profiles.error) throw profiles.error;
    if (roles.error) throw roles.error;
    const keepers = new Set((roles.data ?? []).map((r: { user_id: string }) => r.user_id));
    return (profiles.data ?? []).map((p: { id: string; display_name: string }) => ({ ...p, keeper: keepers.has(p.id) })) as Person[];
  }, []);

  async function toggle(p: Person) {
    setError(null);
    try {
      await (p.keeper ? api.revokeRole(p.id, 'stat_keeper') : api.grantRole(p.id, 'stat_keeper'));
      people.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <h2>Stat keepers</h2>
      {!people.data && !people.error && <p className="muted" role="status">Loading…</p>}
      <p className="muted">People appear here after they sign in and set a name.</p>
      <ul className="list">
        {people.data?.map((p) => (
          <li key={p.id}>
            <span className="meta"><span className="title">{p.display_name}</span>{p.keeper && <span className="pill info">Keeper</span>}</span>
            <button className="secondary" onClick={() => void toggle(p)}>{p.keeper ? 'Remove keeper' : 'Make keeper'}</button>
          </li>
        ))}
      </ul>
      {(error || people.error) && <p className="error" role="alert">{error ?? people.error}</p>}
    </div>
  );
}
