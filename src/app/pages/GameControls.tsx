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
 * game's pairings first: they're frozen once confirmed. "That was the last game" finishes without pairing (t202);
 * the tournament is then over, and Add game N+1 on the list pairs it after all.
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
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null); // unsaved opponent text, tied to its game

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
  const { game, stage } = c;
  const opponent = edit?.id === game.id ? edit.text : null; // null = show the saved name; a draft never carries to another game
  const n = game.number;
  const live = game.started_at !== null && game.finished_at === null;
  const over = game.finished_at !== null; // the newest game is finished: it was the last one
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
  const finish = () => void run(async () => setPreview(await seasonPairings(season.id)));
  const confirm = (p: Preview) => void run(async () => {
    if (over) await api.addNextGame(game.id, p.pairings, p.provisional);
    else await api.finishGame(game.id, p.pairings, p.provisional);
    setPreview(null);
    setStatus(over ? `Game ${n + 1} is paired.` : `${title} finished. Game ${n + 1} is paired.`);
  });
  const finishLast = () => {
    if (!window.confirm(`End ${stage.name} after game ${n}? No game ${n + 1} will be paired.`)) return;
    void run(async () => {
      await api.finishLastGame(game.id);
      // On the list the card itself now says the tournament is over; the board only shows this message.
      setStatus(sessionId === undefined ? null : `${title} finished. ${stage.name} is over.`);
    });
  };

  const nameOpponent = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api.setGameOpponent(game.id, opponent ?? '');
      setEdit(null);
    });
  };

  return (
    <div className={sessionId === undefined ? 'card' : 'stack'} aria-label="Tournament game">
      {sessionId === undefined && <h2>{stage.name} tournament</h2>}
      {over && sessionId === undefined && !preview && (
        <div className="head">
          <span>{stage.name} is over after game {n}.</span>
          <button className="secondary" disabled={busy} onClick={finish}>Add game {n + 1}</button>
        </div>
      )}
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
            {waiting > 0 && <> <small className="muted">Finish waits until your taps are saved.</small></>}
          </span>
          <span className="meta">
            {sessionId === undefined && game.session_id && (
              <button className="secondary" onClick={() => onOpen?.(game.session_id!)}>Tally game {n}</button>
            )}
            <button className="secondary" disabled={busy || waiting > 0} onClick={finishLast}>That was the last game</button>
            <button disabled={busy || waiting > 0} onClick={finish}>Finish game {n}</button>
          </span>
        </div>
      )}
      {sessionId === undefined && !preview && (
        <form className="row" onSubmit={nameOpponent}>
          <label>Opponent<input maxLength={40} placeholder="e.g. Duke" value={opponent ?? game.opponent ?? ''}
            onChange={(e) => setEdit({ id: game.id, text: e.target.value })} /></label>
          <button className="secondary" disabled={busy || opponent === null}>Save opponent</button>
        </form>
      )}
      {preview && (
        <div className="stack" role="group" aria-label={over ? `Add game ${n + 1}` : `Finish game ${n}`}>
          <p>
            <strong>Game {n + 1} pairings</strong>
            {over ? ". They can't change once paired." : ", from the live tally. They can't change once you finish."}
          </p>
          {[...preview.league].map(([leagueId, leagueName]) => (
            <p key={leagueId}>
              {preview.league.size > 1 && <><small className="muted">{leagueName}</small><br /></>}
              {describePairings(preview.pairings.filter((p) => p.league_id === leagueId), preview.team)}
            </p>
          ))}
          {waiting > 0 && <p className="muted"><small>Finish waits until your taps are saved.</small></p>}
          <div className="row">
            <button disabled={busy || waiting > 0} onClick={() => confirm(preview)}>{over ? `Pair game ${n + 1}` : `Finish game ${n}`}</button>
            <button className="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      )}
      {messages}
    </div>
  );
}
