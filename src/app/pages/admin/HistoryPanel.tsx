import { useEffect, useRef, useState } from 'react';
import { Loading } from '../../components/Loading';
import { AUDIT_ACTIONS, describeAudit, humaniseAction, type AuditRow } from '../../lib/audit';
import { errorMessage } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';
import { gameName } from '../../lib/words';

const PAGE = 50;

async function page(action: string, from: number): Promise<AuditRow[]> {
  let q = supabase!.from('audit_log').select('id, at, actor, action, entity, entity_id, details')
    .order('at', { ascending: false }).order('id', { ascending: false });
  if (action) q = q.eq('action', action);
  const { data, error } = await q.range(from, from + PAGE - 1);
  if (error) throw error;
  return (data ?? []) as AuditRow[];
}

type GameRow = { id: string; session_id: string | null; number: number; opponent: string | null; stages: { name: string } | null };

/** Names come from the live tables (every season), so a removed team still shows its name. A game is named under its
 *  game id and its session id ("Game 2 vs UNC (CCCs)"), as game and tally rows log one or the other. */
async function loadNames(): Promise<Map<string, string>> {
  const sb = supabase!;
  const [p, m, a, g, s] = await Promise.all([
    sb.from('profiles').select('id, display_name'), sb.from('memberships').select('id, team_name'),
    sb.from('athletes').select('id, name'), sb.from('games').select('id, session_id, number, opponent, stages(name)'),
    sb.from('stages').select('id, name'),
  ]);
  for (const r of [p, m, a, g, s]) if (r.error) throw r.error;
  const games = ((g.data ?? []) as unknown as GameRow[]).flatMap((x): [string, string][] => {
    const n = x.stages ? `${gameName(x.number, x.opponent)} (${x.stages.name})` : gameName(x.number, x.opponent);
    return x.session_id ? [[x.id, n], [x.session_id, n]] : [[x.id, n]];
  });
  return new Map<string, string>([
    ...games,
    ...((s.data ?? []) as { id: string; name: string }[]).map((x): [string, string] => [x.id, x.name]),
    ...((p.data ?? []) as { id: string; display_name: string }[]).map((x): [string, string] => [x.id, x.display_name]),
    ...((m.data ?? []) as { id: string; team_name: string }[]).map((x): [string, string] => [x.id, x.team_name]),
    ...((a.data ?? []) as { id: string; name: string }[]).map((x): [string, string] => [x.id, x.name]),
  ]);
}

export function HistoryPanel() {
  const names = useLoad(() => loadNames(), []);
  const [action, setAction] = useState('');
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Bumped on every filter change: a page that comes back for an older filter is dropped.
  const token = useRef(0);

  useEffect(() => {
    const mine = ++token.current;
    setRows(null);
    setLoading(false);
    page(action, 0).then(
      (r) => { if (mine === token.current) { setRows(r); setMore(r.length === PAGE); setError(null); } },
      (e) => { if (mine === token.current) setError(errorMessage(e)); },
    );
  }, [action]);

  async function loadMore() {
    const mine = token.current;
    setLoading(true);
    try {
      const r = await page(action, rows!.length);
      if (mine !== token.current) return;
      setRows((cur) => {
        const seen = new Set(cur!.map((x) => x.id));
        return [...cur!, ...r.filter((x) => !seen.has(x.id))];
      });
      setMore(r.length === PAGE);
    } catch (e) {
      if (mine === token.current) setError(errorMessage(e));
    } finally {
      if (mine === token.current) setLoading(false);
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
                <span>{describeAudit(r, names.data!)}<br /><small>{r.actor === null ? 'Automatic' : names.data!.get(r.actor) ?? 'Removed user'}</small></span>
                <small>{new Date(r.at).toLocaleString()}</small>
              </li>
            ))}
          </ul>
          {more && <button className="secondary" disabled={loading} onClick={() => void loadMore()}>Load more</button>}
        </>
      )}
    </div>
  );
}
