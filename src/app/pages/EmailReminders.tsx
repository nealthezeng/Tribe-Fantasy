import { useState } from 'react';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { supabase } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';

/** Me page switch for the M10 emails (bid reminders, next-game pick notices). On unless the user turned it off. */
export function EmailReminders({ uid }: { uid: string }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const on = useLoad(async () => {
    const r = await supabase!.from('profiles').select('notify_email').eq('id', uid).maybeSingle();
    if (r.error) throw r.error;
    return (r.data as { notify_email: boolean } | null)?.notify_email ?? true;
  }, [uid]);

  async function toggle(next: boolean) {
    setError(null);
    setSaving(true);
    try {
      await api.setNotifyEmail(next);
      on.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card">
      <h2>Emails</h2>
      {(error ?? on.error) && <p className="error" role="alert">{error ?? on.error}</p>}
      <label className="check">
        <input type="checkbox" checked={on.data ?? true} disabled={on.data === undefined || saving}
          onChange={(e) => void toggle(e.target.checked)} />
        Email me before bidding closes and when it's time to pick for the next game.
      </label>
    </div>
  );
}
