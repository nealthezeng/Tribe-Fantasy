import { useEffect, useState } from 'react';
import { Loading } from '../../components/Loading';
import { AUDIT_ACTIONS, describeAudit, humaniseAction, type AuditRow } from '../../lib/audit';
import { errorMessage } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

const PAGE = 50;

async function page(action: string, from: number): Promise<AuditRow[]> {
  let q = supabase!.from('audit_log').select('id, at, actor, action, entity, entity_id, details')
    .order('at', { ascending: false }).order('id', { ascending: false });
  if (action) q = q.eq('action', action);
  const { data, error } = await q.range(from, from + PAGE - 1);
  if (error) throw error;
  return (data ?? []) as AuditRow[];
}

/** Every admin action, newest first. Names come from the live tables, so a removed team still shows its name. */
async function loadNames(seasonId: string): Promise<Map<string, string>> {
  const sb = supabase!;
  const [p, m, a] = await Promise.all([
    sb.from('profiles').select('id, display_name'), sb.from('memberships').select('id, team_name'),
    sb.from('athletes').select('id, name').eq('season_id', seasonId),
  ]);
  for (const r of [p, m, a]) if (r.error) throw r.error;
  return new Map<string, string>([
    ...((p.data ?? []) as { id: string; display_name: string }[]).map((x): [string, string] => [x.id, x.display_name]),
    ...((m.data ?? []) as { id: string; team_name: string }[]).map((x): [string, string] => [x.id, x.team_name]),
    ...((a.data ?? []) as { id: string; name: string }[]).map((x): [string, string] => [x.id, x.name]),
  ]);
}

export function HistoryPanel({ seasonId }: { seasonId: string }) {
  const names = useLoad(() => loadNames(seasonId), [seasonId]);
  const [action, setAction] = useState('');
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    page(action, 0).then(
      (r) => { if (live) { setRows(r); setMore(r.length === PAGE); setError(null); } },
      (e) => { if (live) setError(errorMessage(e)); },
    );
    return () => { live = false; };
  }, [action]);

  async function loadMore() {
    try {
      const r = await page(action, rows!.length);
      setRows((cur) => [...cur!, ...r]);
      setMore(r.length === PAGE);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const failed = error ?? names.error;
  return (
    <div className="card">
      <h2>History</h2>
      <label>Action
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((a) => <option key={a} value={a}>{humaniseAction(a)}</option>)}
        </select>
      </label>
      {failed && <p className="error" role="alert">{failed}</p>}
      {!failed && (!rows || !names.data) && <Loading />}
      {rows && names.data && (
        <>
          <ul className="list">
            {rows.length === 0 && <li className="muted">Nothing here yet.</li>}
            {rows.map((r) => (
              <li key={r.id}>
                <span>{describeAudit(r, names.data!)}<br /><small>{names.data!.get(r.actor ?? '') ?? 'Removed user'}</small></span>
                <small>{new Date(r.at).toLocaleString()}</small>
              </li>
            ))}
          </ul>
          {more && <button className="secondary" onClick={() => void loadMore()}>Load more</button>}
        </>
      )}
    </div>
  );
}
