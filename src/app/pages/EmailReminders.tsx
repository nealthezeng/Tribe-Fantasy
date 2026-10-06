import { useState } from 'react';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';

/** Me page switch for the M10 emails (bid reminders, next-game pick notices). On unless the user turned it off. */
export function EmailReminders({ uid }: { uid: string }) {
  const [error, setError] = useState<string | null>(null);
  // The switch flips at once (before the save lands) and rolls back if the save fails.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const on = useLoad(async () => {
    const r = await supabase!.from('profiles').select('notify_email').eq('id', uid).maybeSingle();
    if (r.error) throw r.error;
    return (r.data as { notify_email: boolean } | null)?.notify_email ?? true;
  }, [uid]);

  async function toggle(next: boolean) {
    const before = chosen;
    setError(null);
    setChosen(next);
    setSaving(true);
    try {
      await api.setNotifyEmail(next);
    } catch (err) {
      setChosen(before);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const loadFailed = on.data === undefined && on.error !== null;
  return (
    <div className="card">
      <h2>Emails</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {loadFailed && (
        <p className="error" role="alert">
          {on.error} <button type="button" className="secondary" onClick={on.reload}>Try again</button>
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={chosen ?? on.data ?? true} disabled={on.data === undefined || saving}
          onChange={(e) => void toggle(e.target.checked)} />
        Email me before bidding closes and when it's time to pick for the next game.
      </label>
    </div>
  );
}
