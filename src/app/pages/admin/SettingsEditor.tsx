import { useEffect, useState } from 'react';
import { Loading } from '../../components/Loading';
import { parseSettings, SettingsError } from '../../../core/settings';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

// The settings admins change, as labelled fields: [key, label]. Every setting stays editable as JSON under Advanced.
const STATS = [['goal', 'Goal'], ['assist', 'Assist'], ['block', 'Block'], ['callahan', 'Callahan'], ['turnover', 'Turnover']];
const CREDITS = [['allowance_base', 'Free credits each tournament'], ['allowance_gap', 'Extra for the last-placed team'],
  ['roster_size', 'Players a team can own'], ['picks_per_game', 'Picks each game']];

type Saved = Record<string, unknown> & { stat_weights?: Record<string, unknown> };
type Fields = Record<string, string>;

/** The settings parsed, or as stored when they don't parse (Save then shows why). */
function savedOf(data: unknown): Saved {
  try { return parseSettings(data) as unknown as Saved; } catch { return data as Saved; }
}

const shown = (v: unknown) => (typeof v === 'number' ? String(v) : '');
const fieldsOf = (s: Saved): Fields => Object.fromEntries([
  ...STATS.map(([k]) => [k, shown(s.stat_weights?.[k])]), ...CREDITS.map(([k]) => [k, shown(s[k])]),
]);

/** The saved settings with each changed field put in. Only changed ones, so a stat the season has no points for stays
 *  out; an emptied field becomes NaN, which parseSettings names. */
function withFields(s: Saved, f: Fields, start: Fields): Saved {
  const changed = ([k]: string[]) => f[k] !== start[k];
  const num = (k: string) => (f[k].trim() === '' ? NaN : Number(f[k]));
  const next: Saved = { ...s };
  if (STATS.some(changed)) next.stat_weights = { ...s.stat_weights, ...Object.fromEntries(STATS.filter(changed).map(([k]) => [k, num(k)])) };
  for (const [k] of CREDITS.filter(changed)) next[k] = num(k);
  return next;
}

export function SettingsEditor({ seasonId }: { seasonId: string }) {
  const season = useLoad(async () => {
    const { data, error } = await supabase!.from('seasons').select('settings').eq('id', seasonId).single();
    if (error) throw error;
    return data.settings as unknown;
  }, [seasonId]);
  // The pending edit: JSON or fields, never both (editing one puts the other back to the saved value); null = none.
  const [text, setText] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  // Fresh settings (another season, or the reload after a save) start with nothing pending.
  useEffect(() => { setText(null); setFields(null); }, [season.data]);

  const saved = season.data === undefined ? undefined : savedOf(season.data);
  const savedFields = saved === undefined ? {} : fieldsOf(saved);

  async function save() {
    setIssues([]);
    setStatus(null);
    let parsed;
    try {
      parsed = parseSettings(text !== null ? JSON.parse(text) : withFields(saved!, fields ?? savedFields, savedFields));
    } catch (e) {
      setIssues(e instanceof SettingsError ? e.issues : [`Not valid JSON: ${(e as Error).message}`]);
      return;
    }
    try {
      await api.updateSeasonSettings(seasonId, parsed);
      setStatus('Saved.');
      void season.reload();
    } catch (err) {
      setIssues([errorMessage(err)]);
    }
  }

  // Stat points may be fractional (any finite number); the credit, roster and pick settings are whole numbers.
  const field = ([k, label]: string[], step?: string) => (
    <label key={k}>{label}
      <input type="number" step={step} value={(fields ?? savedFields)[k]}
        onChange={(e) => { setFields({ ...(fields ?? savedFields), [k]: e.target.value }); setText(null); setStatus(null); }} />
    </label>
  );

  return (
    <div className="card">
      <div className="stack">
        {season.data === undefined && !season.error && <Loading />}
        {saved !== undefined && (
          <>
            <h2>Points for stats</h2>
            <div className="row">{STATS.map((f) => field(f, 'any'))}</div>
            <h2>Credits and picks</h2>
            <div className="row">{CREDITS.map((f) => field(f))}</div>
            <details className="section">
              <summary>Advanced (all settings as JSON)</summary>
              <textarea aria-label="Season settings JSON" value={text ?? JSON.stringify(saved, null, 2)} spellCheck={false}
                onChange={(e) => { setText(e.target.value); setFields(null); setStatus(null); }} />
            </details>
            <button onClick={save}>Save settings</button>
          </>
        )}
        {status && <p className="success" role="status">{status}</p>}
        {issues.length > 0 && <ul className="error" role="alert">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        {season.error && <p className="error" role="alert">{season.error}</p>}
      </div>
    </div>
  );
}
