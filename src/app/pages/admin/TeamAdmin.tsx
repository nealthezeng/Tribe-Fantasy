import { useState, type FormEvent } from 'react';
import { rosterOf, slotLive } from '../../../core/tournament';
import { errorMessage } from '../../lib/errors';
import { api } from '../../lib/rpc';
import type { LeagueAdminData } from './LeagueBrowser';

/** The players a team holds right now in the shown tournament, each with the share (0–1) it owns. */
export function liveRoster(d: LeagueAdminData, membershipId: string): { id: string; share: number }[] {
  const { y, stageId } = d;
  if (stageId === null) return [];
  const upTo = d.nextGame ?? Infinity; // between tournaments every slot not yet ended still counts
  return rosterOf(y.input, membershipId, stageId, upTo).map((id) => ({
    id,
    share: y.input.slots.filter((x) => x.stageId === stageId && x.membershipId === membershipId && x.athleteId === id && slotLive(x, upTo))
      .reduce((sum, x) => sum + x.share, 0),
  }));
}

const isPercent = (v: string) => /^\d+$/.test(v) && +v >= 1 && +v <= 100;

/** Runs one admin call, then reloads; the error sentence stays until the next try. */
function useAct(onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(run: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await run();
      onChanged();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, act };
}

function ShareRow({ name, team, share, disabled, set }: {
  name: string; team: string; share: number; disabled: boolean; set: (percent: number | null) => void;
}) {
  const [value, setValue] = useState(String(share));
  const same = value === String(share);
  return (
    <li>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (isPercent(value)) set(+value); }}>
        <label>{name} (%)
          <input type="number" inputMode="numeric" min={1} max={100} step={1} value={value} onChange={(e) => setValue(e.target.value)}
            aria-invalid={!isPercent(value)} />
        </label>
        <button disabled={disabled || same || !isPercent(value)}>Save</button>
        <button type="button" className="danger-link" disabled={disabled} aria-label={`Remove ${name} from ${team}`} onClick={() => set(null)}>Remove</button>
      </form>
    </li>
  );
}

/** Give a team a share of a player, change it, take it away, or rename the team. Free: it never touches credits. */
export function TeamAdmin({ data, membershipId, onChanged }: { data: LeagueAdminData; membershipId: string; onChanged: () => void }) {
  const { y, stageId } = data;
  const team = y.team.get(membershipId) ?? 'A team';
  const [player, setPlayer] = useState('');
  const [percent, setPercent] = useState('');
  const [name, setName] = useState(team);
  const { busy, error, act } = useAct(onChanged);
  if (y.input.members.find((m) => m.id === membershipId)?.removedAt != null) return null;

  const roster = liveRoster(data, membershipId);
  const label = (id: string) => y.athlete.get(id) ?? 'A player';
  const set = (athlete: string, p: number | null) => act(() => api.adminSetShare(stageId!, membershipId, athlete, p));
  async function add(e: FormEvent) {
    e.preventDefault();
    if (!player || !isPercent(percent)) return;
    if (await set(player, +percent)) { setPlayer(''); setPercent(''); }
  }
  const trimmed = name.trim();
  return (
    <>
      <ul className="list">
        {roster.map((p) => (
          // Remount on a reload so the box shows the share as it now is.
          <ShareRow key={`${p.id}:${Math.round(p.share * 100)}`} name={label(p.id)} team={team} share={Math.round(p.share * 100)}
            disabled={busy} set={(v) => void set(p.id, v)} />
        ))}
      </ul>
      {roster.length > y.settings.roster_size && <small className="hint">{roster.length} of {y.settings.roster_size} players</small>}
      {stageId !== null && data.stageSettled ? (
        <form className="row" onSubmit={(e) => void add(e)}>
          <label>Player
            <select value={player} onChange={(e) => setPlayer(e.target.value)}>
              <option value="">Choose</option>
              {data.players.filter((a) => !roster.some((p) => p.id === a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>Share (%)
            <input type="number" inputMode="numeric" min={1} max={100} step={1} value={percent} onChange={(e) => setPercent(e.target.value)} />
          </label>
          <button disabled={busy || !player || !isPercent(percent)}>Add</button>
        </form>
      ) : <small className="hint">Close share buying first</small>}
      <form className="row" onSubmit={(e) => { e.preventDefault(); void act(() => api.adminRenameTeam(membershipId, trimmed)); }}>
        <label>Team name
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="secondary" disabled={busy || !trimmed || trimmed === team}>Rename</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
