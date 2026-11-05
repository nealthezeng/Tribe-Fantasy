import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Avatar } from '../components/Avatar';
import { randomAvatar, resolveAvatar, slotsFor, SLOTS, type AvatarChoice, type Part, type Slot } from '../lib/avatar';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';

/** Build your avatar on Me. Choices change the preview only, until Save. Hidden rows keep their values, so changing pose and back loses nothing. */
export function AvatarPicker({ uid }: { uid: string }) {
  const { avatar, refresh } = useAuth();
  const [choice, setChoice] = useState(() => resolveAvatar(avatar, uid));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (next: AvatarChoice) => {
    setChoice(next);
    setSaved(false);
  };

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await api.setAvatar(choice);
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  const shown = slotsFor(choice.pose);
  return (
    <div className="card">
      <h2>Your avatar</h2>
      <div className="avatar-stage">
        <Avatar choice={choice} />
        <div className="avatar-actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => change(randomAvatar())}>Shuffle</button>
          <button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save avatar'}</button>
          {saved && <small className="success" role="status">Saved.</small>}
          {/* Here and not under the card's heading: Save stays in sight as the rows scroll, so its answer has to as well. */}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </div>
      {SLOTS.filter((s) => shown.includes(s.slot)).map(({ slot, label, parts }) => (
        <fieldset key={slot} className="avatar-slot" disabled={busy}>
          <legend>{label}</legend>
          <div className="avatar-options">
            {parts.map((p) => <Option key={p.key} slot={slot} part={p} choice={choice} onPick={change} />)}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/** One tappable part: a real radio over a swatch, or over the figure trying that part on. */
function Option({ slot, part, choice, onPick }: { slot: Slot; part: Part; choice: AvatarChoice; onPick: (next: AvatarChoice) => void }) {
  const next = { ...choice, [slot]: part.key };
  return (
    <label className="avatar-option">
      <input type="radio" name={`avatar-${slot}`} value={part.key} checked={choice[slot] === part.key} onChange={() => onPick(next)} />
      {part.color && slot !== 'frisbee'
        ? <span className="avatar-swatch" style={{ background: part.color }} />
        : <Avatar choice={next} />}
      {part.label}
    </label>
  );
}
