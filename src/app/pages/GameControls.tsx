import { useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import type { CurrentSeason } from '../lib/stats';
import { describePairings, loadCurrentGame, seasonPairings } from '../lib/tournament';
import { useLoad } from '../lib/useLoad';

type Preview = Awaited<ReturnType<typeof seasonPairings>>;

/**
 * Tournament controls on the tally screen (spec §2): Start game N on the session list, Finish game N on the live
 * game's board (and on the list, so a game whose session was deleted can still be finished). Finish shows the next
 * game's pairings first: they're frozen once confirmed. The games exist from the start (the admin sets the count), so
 * Finish on a non-last game pairs the next one that already exists; Finish on the last game just confirms and ends the
 * tournament. The list also holds the opponents list: one name field per game (t313).
 */
export function GameControls({ season, sessionId, unsaved = new Map(), onOpen }: {
  season: CurrentSeason;
  /** On a board: show Finish only when this session is the live game's. */
  sessionId?: string;
  /** Unsaved taps per session: Finish waits until taps on this phone for the game's session are saved. */
  unsaved?: Map<string, number>;
  /** On the session list: open a session's board. */
  onOpen?: (sessionId: string) => void;
}) {
  const current = useLoad(() => loadCurrentGame(season.id), [season.id]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({}); // unsaved opponent text by game id

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
      setPreview(null);
    }
    setBusy(false);
    current.reload(); // e.g. GAME_STARTED: another keeper got there first
  }

  const messages = (
    <>
      {status && <p className="success" role="status">{status}</p>}
      {(error || current.error) && <p className="error" role="alert">{error ?? current.error}</p>}
    </>
  );
  const c = current.data;
  if (!c) return messages;
  const { game, stage, games, count } = c;
  const n = game.number;
  const live = game.started_at !== null && game.finished_at === null;
  const over = game.finished_at !== null; // loadCurrentGame returns the last game once every game is finished
  const isLast = n === count;
  const title = game.opponent ? `Game ${n} vs ${game.opponent}` : `Game ${n}`;
  const waiting = game.session_id ? unsaved.get(game.session_id) ?? 0 : 0;
  if (sessionId !== undefined && !(live && game.session_id === sessionId)) return messages;

  const start = () => {
    if (!window.confirm(`Start game ${n}? Every team's pick locks now.`)) return;
    void run(async () => {
      const sid = await api.startGame(game.id);
      onOpen?.(sid);
    });
  };
  // finish_game's answer decides the message: an id = the next game is paired; null = no game after it, so it's over.
  // On the list the card itself says the tournament is over; the board only shows this message.
  const done = (next: string | null) => setStatus(next ? `${title} finished. Game ${n + 1} is paired.`
    : sessionId === undefined ? null : `${title} finished. ${stage.name} is over.`);
  const finish = () => {
    if (!isLast) return void run(async () => setPreview(await seasonPairings(season.id)));
    if (!window.confirm(`Finish game ${n}? It's the last game: ${stage.name} ends.`)) return;
    void run(async () => {
      done(await api.finishGame(game.id, [], []));
    });
  };
  const confirm = (p: Preview) => void run(async () => {
    const next = await api.finishGame(game.id, p.pairings, p.provisional);
    setPreview(null);
    done(next);
  });

  const nameOpponent = (id: string) => (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.setGameOpponent(id, drafts[id]);
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== id)));
    });
  };

  return (
    <div className={sessionId === undefined ? 'card' : 'stack'} aria-label="Tournament game">
      {sessionId === undefined && <h2>{stage.name} tournament</h2>}
      {over && sessionId === undefined && !preview && <p>{stage.name} is over after game {n}.</p>}
      {!live && !over && sessionId === undefined && (
        <div className="head">
          <span>{title} is next. Starting it locks every team's pick.</span>
          <button disabled={busy} onClick={start}>Start game {n}</button>
        </div>
      )}
      {live && !preview && (
        <div className="head">
          <span>
            {game.session_id ? <>{title} is live.</> : <>{title}: its tally was deleted, so it won't count. Finish it to pair the next game.</>}
          </span>
          <span className="meta">
            {sessionId === undefined && game.session_id && (
              <button className="secondary" onClick={() => onOpen?.(game.session_id!)}>Tally game {n}</button>
            )}
            <button disabled={busy || waiting > 0} onClick={finish}>Finish game {n}</button>
          </span>
        </div>
      )}
      {sessionId === undefined && !preview && (
        <ul className="list">
          {games.map((g) => (
            <li key={g.id}>
              <form className="row" onSubmit={nameOpponent(g.id)}>
                <label>Game {g.number}<input maxLength={40} placeholder="e.g. Duke" value={drafts[g.id] ?? g.opponent ?? ''}
                  onChange={(e) => setDrafts({ ...drafts, [g.id]: e.target.value })} /></label>
                <button className="secondary" disabled={busy || drafts[g.id] === undefined}>Save</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {preview && (
        <div className="stack" role="group" aria-label={`Finish game ${n}`}>
          <p><strong>Game {n + 1} pairings</strong></p>
          {[...preview.league].map(([leagueId, leagueName]) => (
            <p key={leagueId}>
              {preview.league.size > 1 && <><small className="muted">{leagueName}</small><br /></>}
              {describePairings(preview.pairings.filter((p) => p.league_id === leagueId), preview.team)}
            </p>
          ))}
          <div className="row">
            <button disabled={busy || waiting > 0} onClick={() => confirm(preview)}>Finish game {n}</button>
            <button className="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
      {messages}
    </div>
  );
}
