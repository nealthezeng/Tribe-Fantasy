import { useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import type { GameRow } from '../lib/tournament';

/**
 * Every game's opponent in one form (X12): the Tally hub's Opponents fold and Admin › Tournaments' Games and count row.
 * Save sends only the boxes that changed; an empty box clears the name. Keepers and admins can set any game's.
 */
export function OpponentsForm({ games, onSaved }: { games: Pick<GameRow, 'id' | 'number' | 'opponent'>[]; onSaved: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // unsaved opponent text by game id
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = games.filter((g) => drafts[g.id] !== undefined && drafts[g.id] !== (g.opponent ?? ''));

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      for (const g of changed) await api.setGameOpponent(g.id, drafts[g.id]);
      setDrafts({});
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  return (
    <form onSubmit={save}>
      {games.map((g) => (
        <label key={g.id}>Game {g.number}<input maxLength={40} placeholder="Opponent" value={drafts[g.id] ?? g.opponent ?? ''}
          onChange={(e) => { setDrafts({ ...drafts, [g.id]: e.target.value }); setSaved(false); }} /></label>
      ))}
      <button className="secondary" disabled={busy || changed.length === 0}>Save opponents</button>
      {saved && <small className="success" role="status">Opponents saved.</small>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
