import { useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Avatar } from '../components/Avatar';
import { randomAvatar, resolveAvatar, slotsFor, SLOTS, type AvatarChoice, type Part, type Slot } from '../lib/avatar';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';

/** Your avatar on Me, and under Edit avatar the selector that builds it. Choices change the preview only, until Save. Hidden rows keep their values, so changing pose and back loses nothing. */
export function AvatarPicker({ uid }: { uid: string }) {
  const { avatar, refresh } = useAuth();
  const [stored, setStored] = useState(() => resolveAvatar(avatar, uid));
  const [choice, setChoice] = useState(stored);
  const [open, setOpen] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = (next: AvatarChoice) => {
    setChoice(next);
    setSaved(false);
  };

  function toggle() {
    setOpen(!open);
    setSaved(false);
    setError(null);
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      await api.setAvatar(choice);
      await refresh();
      setStored(choice);
      setSaved(true);
      setOpen(false);
      editButton.current?.focus(); // Save is about to go, and focus would fall to the page with it.
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  const shown = slotsFor(choice.pose);
  return (
    <div className="stack">
      <div className="avatar-stage">
        {open && <button type="button" className="secondary" disabled={busy} onClick={() => change(randomAvatar())}>Shuffle</button>}
        <div className="avatar-me">
          {/* Closed shows what others see. Unsaved picks wait for the next open. */}
          <Avatar choice={open ? choice : stored} />
          <button ref={editButton} type="button" className="linklike" aria-expanded={open} onClick={toggle}>Edit avatar</button>
        </div>
        {open && <button type="button" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save avatar'}</button>}
        {saved && <small className="success" role="status">Saved.</small>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>
      {open && (
        <div className="card">
          {SLOTS.filter((s) => shown.includes(s.slot)).map(({ slot, label, parts }) => (
            <fieldset key={slot} className="avatar-slot" disabled={busy}>
              <legend>{label}</legend>
              <div className="avatar-options">
                {parts.map((p) => <Option key={p.key} slot={slot} part={p} choice={choice} onPick={change} />)}
              </div>
            </fieldset>
          ))}
        </div>
      )}
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
