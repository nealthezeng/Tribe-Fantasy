import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import type { CurrentSeason } from '../lib/stats';
import { supabase } from '../lib/supabase';
import { describePairings, loadCurrentGame, rowsOf, seasonPairings } from '../lib/tournament';
import { useLoad } from '../lib/useLoad';
import { gameName, rowStatus, type StatusWord } from '../lib/words';

type Preview = Awaited<ReturnType<typeof seasonPairings>>;

/** A status word; Live gets the red dot (P9 rule 5). */
const said = (w: StatusWord) => (w === 'Live' ? <span className="live"><span className="dot" aria-hidden="true" />Live</span> : <span>{w}</span>);

/**
 * Tournament controls on the tally screen (spec §2). On the games list (the hub): the stage card with the current game,
 * its status and the one gold action (Start game N, or Tally game N while it's live), a row per game of the stage, and
 * the Opponents fold (one form for every game, t313). On the live game's board: Finish game N only, a quiet button at
 * the board's end. Finish asks first, with the next game's pairings in a fold: they're frozen once confirmed. The games
 * exist from the start (the admin sets the count), so Finish on a non-last game pairs the next one that already exists;
 * Finish on the last game just confirms and ends the tournament. A live game whose session was deleted has no board, so
 * the list keeps its Finish.
 */
export function GameControls({ season, sessionId, unsaved = new Map(), onOpen }: {
  season: CurrentSeason;
  /** On a board: show Finish only when this session is the live game's. */
  sessionId?: string;
  /** Unsaved taps per session: Finish waits until taps on this phone for the game's session are saved. */
  unsaved?: Map<string, number>;
  /** On the games list: open the board of the game Start just started. */
  onOpen?: (sessionId: string) => void;
}) {
  const current = useLoad(async () => {
    const c = await loadCurrentGame(season.id);
    // The list's status words need each game session's verified_at; the board needs none.
    const ids = c && sessionId === undefined ? c.games.flatMap((g) => (g.session_id ? [g.session_id] : [])) : [];
    const sessions = await rowsOf<{ id: string; verified_at: string | null }>(
      ids.length ? supabase!.from('sessions').select('id, verified_at').in('id', ids) : null);
    return c && { ...c, verified: new Map(sessions.map((s) => [s.id, s.verified_at])) };
  }, [season.id, sessionId]);
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
  const { game, stage, games, count, verified } = c;
  const n = game.number;
  const live = game.started_at !== null && game.finished_at === null;
  const over = game.finished_at !== null; // loadCurrentGame returns the last game once every game is finished
  const isLast = n === count;
  const title = gameName(n, game.opponent);
  const named = title.replace(/^Game/, 'game'); // mid-sentence: "game 2 vs UNC"
  const waiting = game.session_id ? unsaved.get(game.session_id) ?? 0 : 0;
  const word = (g: typeof game) => rowStatus({ ...g, verified_at: g.session_id ? verified.get(g.session_id) ?? null : null });

  const start = () => {
    if (!window.confirm(`Start ${named}? Every team's picks for it lock now.`)) return;
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

  const finishing = preview ? (
    <div className="stack" role="group" aria-label={`Finish game ${n}`}>
      <p>Finish {named}? Game {n + 1} gets paired; an admin can undo it.</p>
      <details>
        <summary>Game {n + 1} pairings</summary>
        {[...preview.league].map(([leagueId, leagueName]) => (
          <p key={leagueId}>
            {preview.league.size > 1 && <><small className="muted">{leagueName}</small><br /></>}
            {describePairings(preview.pairings.filter((p) => p.league_id === leagueId), preview.team)}
          </p>
        ))}
      </details>
      <div className="row">
        <button disabled={busy || waiting > 0} onClick={() => confirm(preview)}>Finish game {n}</button>
        <button className="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel</button>
      </div>
    </div>
  ) : <button className={sessionId === undefined ? undefined : 'secondary'} disabled={busy || waiting > 0} onClick={finish}>Finish game {n}</button>;

  if (sessionId !== undefined) {
    return live && game.session_id === sessionId ? <div className="stack">{finishing}{messages}</div> : messages;
  }

  const changed = games.filter((g) => drafts[g.id] !== undefined && drafts[g.id] !== (g.opponent ?? ''));
  const saveOpponents = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      for (const g of changed) await api.setGameOpponent(g.id, drafts[g.id]);
      setDrafts({});
    });
  };

  return (
    <>
      <article className="card">
        <p className="strip"><strong>{stage.name} · {title}</strong>{said(word(game))}</p>
        {over && <p>{stage.name} is over after game {n}.</p>}
        {!live && !over && <button disabled={busy} onClick={start}>Start game {n}</button>}
        {live && game.session_id && <Link className="button" to={`/tally?game=${game.session_id}`}>Tally game {n}</Link>}
        {live && !game.session_id && <><p>Its tally was deleted, so it won't count. Finish it to pair the next game.</p>{finishing}</>}
        <ul className="list">
          {games.map((g) => {
            const w = word(g);
            const who = <span className="who"><b>{gameName(g.number, g.opponent)}</b><small>{said(w)}</small></span>;
            // Not started, or its tally deleted: nothing to open, so no link and no chevron (rule 1).
            if (!g.session_id || w === 'Not started') return <li key={g.id}><div className="row-link">{who}</div></li>;
            const left = unsaved.get(g.session_id) ?? 0; // taps still on this phone: the board uploads them
            return (
              <li key={g.id}>
                <Link className="row-link" to={w === 'Live' || left ? `/tally?game=${g.session_id}` : `/stats/${g.session_id}`}>
                  {who}
                  {left ? <span className="pill warn">{left} unsaved</span>
                    : w === 'Finished · not verified' && <span className="pill warn">To verify</span>}
                </Link>
              </li>
            );
          })}
        </ul>
        {messages}
      </article>
      <details className="card">
        <summary><h2>Opponents</h2></summary>
        <form onSubmit={saveOpponents}>
          {games.map((g) => (
            <label key={g.id}>Game {g.number}<input maxLength={40} placeholder="Opponent" value={drafts[g.id] ?? g.opponent ?? ''}
              onChange={(e) => setDrafts({ ...drafts, [g.id]: e.target.value })} /></label>
          ))}
          <button className="secondary" disabled={busy || changed.length === 0}>Save opponents</button>
        </form>
      </details>
    </>
  );
}
