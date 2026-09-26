import { useEffect, useState } from 'react';
import { parseSettings, SettingsError } from '../../../core/settings';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import { supabase } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

export function SettingsEditor({ seasonId }: { seasonId: string }) {
  const season = useLoad(async () => {
    const { data, error } = await supabase!.from('seasons').select('settings').eq('id', seasonId).single();
    if (error) throw error;
    return data.settings as unknown;
  }, [seasonId]);
  const [text, setText] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (season.data !== undefined) {
      try {
        setText(JSON.stringify(parseSettings(season.data), null, 2));
      } catch {
        setText(JSON.stringify(season.data, null, 2));
      }
    }
  }, [season.data]);

  async function save() {
    setIssues([]);
    setStatus(null);
    let parsed;
    try {
      parsed = parseSettings(JSON.parse(text));
    } catch (e) {
      setIssues(e instanceof SettingsError ? e.issues : [`Not valid JSON: ${(e as Error).message}`]);
      return;
    }
    try {
      await api.updateSeasonSettings(seasonId, parsed);
      setStatus('Saved.');
    } catch (err) {
      setIssues([errorMessage(err)]);
    }
  }

  return (
    <div className="card">
      <h2>Season settings</h2>
      <div className="stack">
        <p className="muted">Every rule knob from the spec, as JSON. Changes are validated here and recorded in the audit log.</p>
        {season.data === undefined && !season.error && <p className="muted" role="status">Loading…</p>}
        <textarea aria-label="Season settings JSON" value={text} onChange={(e) => { setText(e.target.value); setStatus(null); }} spellCheck={false} />
        <button onClick={save}>Validate and save</button>
        {status && <p className="success" role="status">{status}</p>}
        {issues.length > 0 && <ul className="error" role="alert">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        {season.error && <p className="error" role="alert">{season.error}</p>}
      </div>
    </div>
  );
}
