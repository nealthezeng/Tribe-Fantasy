import { useState, type ReactNode } from 'react';
import { rawScore } from '../../core/scoring';
import type { GameOutcome, NextGame, TournamentSide } from '../../core/tournament';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { formatDay, statLabel } from '../lib/stats';
import { loadLeagueTournament, type LeagueTournament } from '../lib/tournament';
import { useLoad } from '../lib/useLoad';

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(Math.abs(n))}`;
/** An athlete's name, or `none` when nobody plays. */
const athleteName = (y: LeagueTournament, id: string | null, none = 'nobody') => (id ? y.athlete.get(id) ?? 'A player' : none);
const sides = (g: GameOutcome) => g.matchups.flatMap((m) => [m.home, m.away]);
const opponentIn = (g: GameOutcome, membershipId: string): TournamentSide | null | undefined => {
  const m = g.matchups.find((x) => x.home.membershipId === membershipId || x.away?.membershipId === membershipId);
  if (!m) return undefined; // not in this game
  return m.home.membershipId === membershipId ? m.away : m.home;
};

/**
 * One team on the League tab, matchup first: the game that matters now as a big headline with both picks, the
 * team's credits, place and record, then `children` (the auction), then the next pick, standings and every game.
 * Standings show all season, between tournaments too.
 */
export function TournamentCard({ membershipId, leagueId, seasonId, teamName, subtitle, balance, children }: {
  membershipId: string; leagueId: string; seasonId: string; teamName: string; subtitle: string; balance: number;
  children?: ReactNode;
}) {
  const { data, error, reload } = useLoad(() => loadLeagueTournament(seasonId, leagueId), [seasonId, leagueId]);
  if (!data) {
    return (
      <>
        <div className="matchup"><h2 className="display">{teamName}</h2><p className="strip">{subtitle}</p></div>
        {children}
        {error ? <p className="error" role="alert">{error}</p> : <p className="muted" role="status">Loading games…</p>}
      </>
    );
  }
  const { games, next } = data.result;
  const played = [...games].reverse().filter((g) => g.status === 'pending' || g.status === 'final' || g.status === 'void');

  return (
    <>
      <Matchup y={data} membershipId={membershipId} teamName={teamName} subtitle={subtitle} balance={balance} />
      {children}
      <article className="card" aria-label="Tournament">
        <h2>Tournament</h2>
        {error && <p className="error" role="alert">{error}</p>}
        {next && <PickGame key={`${next.stageId}:${next.number}`} y={data} next={next} membershipId={membershipId} onSaved={reload} />}
        <Standings y={data} membershipId={membershipId} />
        <div className="section">
          <h3>Games</h3>
          {played.map((g) => <GameRow key={g.game.id} y={data} g={g} membershipId={membershipId} />)}
          {played.length === 0 && <p className="muted">No games played yet.</p>}
        </div>
      </article>
    </>
  );
}

/** The game that matters now: the live one, else the next one, else the last one played. */
function focusGame(y: LeagueTournament, membershipId: string) {
  const { games, next } = y.result;
  const mineIn = (g: GameOutcome) => opponentIn(g, membershipId) !== undefined;
  const live = games.find((g) => g.status === 'live' && mineIn(g));
  if (live) return { stageId: live.game.stageId, number: live.game.number, g: live };
  if (next) {
    const g = games.find((x) => x.game.stageId === next.stageId && x.game.number === next.number);
    return { stageId: next.stageId, number: next.number, g: g && mineIn(g) ? g : null };
  }
  const last = [...games].reverse().find((g) => (g.status === 'final' || g.status === 'pending') && mineIn(g));
  return last ? { stageId: last.game.stageId, number: last.game.number, g: last } : null;
}

const RESULT = { W: 'Won', L: 'Lost', T: 'Tied' } as const;

function Matchup({ y, membershipId, teamName, subtitle, balance }: {
  y: LeagueTournament; membershipId: string; teamName: string; subtitle: string; balance: number;
}) {
  const focus = focusGame(y, membershipId);
  const g = focus?.g ?? null;
  const status = g?.status ?? 'upcoming';
  const final = status === 'final';
  const mine = g ? sides(g).find((x) => x?.membershipId === membershipId) ?? null
    : y.result.next?.sides.find((x) => x.membershipId === membershipId) ?? null;
  const them = g ? opponentIn(g, membershipId) : undefined; // undefined = not paired yet, null = bye
  const dates = focus && y.stageDates.get(focus.stageId);
  const row = y.result.standings.find((r) => r.membershipId === membershipId);
  // Before a game starts the scorer's auto-pick is a guess, so show only the manager's own pick.
  const minePlayer = status === 'upcoming' ? mine?.picked ?? null : mine?.athleteId ?? null;

  return (
    <>
      <div className="matchup">
        <h2 className="display">
          {teamName}
          {them && <> <span className="vs">vs</span> {y.team.get(them.membershipId)}</>}
        </h2>
        <p className="strip">
          {focus ? <>
            <span>{y.stage.get(focus.stageId)}</span>
            {dates && <span className="chip">{formatDay(dates.starts_on)} – {formatDay(dates.ends_on)}</span>}
            <span>Game {focus.number}</span>
            {status === 'live' && <span className="live"><span className="dot" aria-hidden="true" />Live</span>}
            {status === 'upcoming' && <span>{them === null ? 'Bye' : 'Next up'}</span>}
            {status === 'pending' && <span>Waiting on stats</span>}
            {final && mine?.result && <strong>{RESULT[mine.result]} {signed(mine.delta ?? 0)}</strong>}
          </> : <span>{subtitle}</span>}
        </p>
      </div>
      {g && them && mine && (
        <div className="score">
          <ScoreSide label={status === 'upcoming' ? 'Your pick' : 'You played'} y={y} athleteId={minePlayer}
            picked={status === 'upcoming' && minePlayer !== null}
            score={final ? mine.score : null} empty={status === 'upcoming' ? 'No pick yet' : 'Forfeit'} lost={final && mine.result === 'L'} />
          <span className="vs">{final ? 'to' : 'vs'}</span>
          <ScoreSide label={status === 'upcoming' ? 'Their pick' : 'They played'} y={y}
            athleteId={status === 'upcoming' ? null : them.athleteId} score={final ? them.score : null}
            empty={status === 'upcoming' ? 'Hidden' : 'Forfeit'} lost={final && mine.result === 'W'} />
          {(status === 'live' || status === 'pending') && <p className="score-note">Scores appear once this game's stats lock.</p>}
        </div>
      )}
      {mine && status !== 'upcoming' && <Notice y={y} side={mine} />}
      <dl className="tiles">
        <div><dt>Credits</dt><dd className="big">{balance}</dd></div>
        <div><dt>Place</dt><dd><span className="big">{row ? `${row.tied ? 'T' : ''}${row.place}` : '–'}</span> <span className="of">of {y.result.standings.length}</span></dd></div>
        <div><dt>Record</dt><dd className="big">{row ? `${row.wins}–${row.losses}${row.ties ? `–${row.ties}` : ''}` : '–'}</dd></div>
      </dl>
    </>
  );
}

function ScoreSide({ label, y, athleteId, score, empty, lost = false, picked = false }: {
  label: string; y: LeagueTournament; athleteId: string | null; score: number | null; empty: string; lost?: boolean;
  /** Your pick is set for the next game: shown in green. */
  picked?: boolean;
}) {
  const name = athleteId ? y.athlete.get(athleteId) ?? 'A player' : empty;
  return (
    <div className={['score-side', lost && 'lost', picked && 'picked'].filter(Boolean).join(' ')}>
      <small>{label}</small>
      {score !== null ? <><span className="pts">{fmt(score)}</span><strong>{name}</strong></> : <span className="pts-name">{name}</span>}
    </div>
  );
}

function PickGame({ y, next, membershipId, onSaved }: {
  y: LeagueTournament; next: NextGame; membershipId: string; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string | null) => athleteName(y, id);
  const mine = next.sides.find((x) => x.membershipId === membershipId);
  const title = `Game ${next.number} · ${y.stage.get(next.stageId) ?? ''}`;
  if (!mine) {
    return <div className="stack"><h3>{title}</h3><p className="muted">You have no players this tournament, so you forfeit each game you're paired in.</p></div>;
  }
  const paired = y.result.games.find((g) => g.game.stageId === next.stageId && g.game.number === next.number);
  const them = paired ? opponentIn(paired, membershipId) : undefined;
  if (paired && them === undefined) {
    return <div className="stack"><h3>{title}</h3><p className="muted">You joined after this game was paired. You'll play from the next game.</p></div>;
  }
  const started = y.input.games.some((g) => g.stageId === next.stageId && g.startedAt !== null);
  const swapUsed = y.input.swaps.some((w) => w.stageId === next.stageId && w.membershipId === membershipId);
  const injuredActive = mine.active.filter((a) => y.injured.has(a));
  const byName = (a: string, b: string) => name(a).localeCompare(name(b));

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
    onSaved(); // a refused pick usually means the game just started: show it
  }
  const choose = (athleteId: string | null) => act(() => api.setGamePick(membershipId, next.stageId, next.number, athleteId));
  // ponytail: benching rotates out the longest-benched player; with the default bench of 1 that's a plain swap.
  const bench = (athleteId: string) => act(() => api.setBench(membershipId, next.stageId, [athleteId, ...mine.bench].slice(0, mine.bench.length)));
  const swapIn = (out: string, inAthlete: string) => {
    if (!window.confirm(`Swap ${name(inAthlete)} in for ${name(out)} for the rest of this tournament? You get one swap per tournament.`)) return;
    void act(() => api.swapBench(membershipId, next.stageId, out, inAthlete));
  };

  return (
    <div className="stack">
      <div className="head">
        <h3>{title}</h3>
        <span className="pill info">Picks lock when the game starts</span>
      </div>
      <p>
        {them ? <>You play <strong>{y.team.get(them.membershipId)}</strong>. Their pick stays hidden until the game starts.</>
          : them === null ? 'You have a bye this game.'
            : next.number === 1 ? 'Your opponent is set when the tournament opens. You can pick now.'
              : `Your opponent is set when game ${next.number - 1} finishes. You can pick now.`}
      </p>
      {mine.notice === 'missed' && (
        <p className="notice">No pick yet. If you don't pick, {name(mine.athleteId)} plays{mine.athleteId ? '' : ' and you forfeit'}.</p>
      )}
      {mine.notice === 'injured' && (
        <p className="notice">{name(mine.picked)} is injured. When the game starts we'll play {name(mine.athleteId)} unless you change your pick.</p>
      )}
      {mine.notice === 'inactive' && (
        <p className="notice">{name(mine.picked)} is on your bench, so {name(mine.athleteId)} plays unless you change your pick.</p>
      )}
      <ul className="list">
        {[...mine.active].sort(byName).map((id) => {
          const chosen = mine.picked === id;
          const tired = mine.rest[id] < 1;
          return (
            <li key={id}>
              <span className="meta">
                <span className="title">{name(id)}</span>
                {tired && <span className="pill warn">Tired ×{fmt(mine.rest[id])}</span>}
                {y.injured.has(id) && <span className="pill bad">Injured</span>}
              </span>
              {!started && mine.bench.length > 0 && (
                <button className="secondary" aria-label={`Bench ${name(id)}`} disabled={busy} onClick={() => void bench(id)}>Bench</button>
              )}
              {chosen ? (
                <button className="secondary picked" aria-pressed="true" disabled={busy} onClick={() => void choose(null)}>
                  <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" /></svg>
                  Your pick <span className="clear">· Clear</span>
                </button>
              ) : (
                <button aria-label={`Pick ${name(id)}`} disabled={busy} onClick={() => void choose(id)}>Pick</button>
              )}
            </li>
          );
        })}
        {[...mine.bench].sort(byName).map((id) => (
          <li key={id} className="used">
            <span className="meta">
              <span className="title">{name(id)}</span>
              <span className="pill">Bench</span>
              {y.injured.has(id) && <span className="pill bad">Injured</span>}
            </span>
            {started && !swapUsed && injuredActive.map((out) => (
              <button key={out} className="secondary" disabled={busy} onClick={() => swapIn(out, id)}>Swap in for {name(out)}</button>
            ))}
          </li>
        ))}
      </ul>
      <p className="muted"><small>
        {started
          ? 'Your bench player comes in only if an active player gets injured (one swap per tournament).'
          : 'Choose your bench before game 1 starts. It plays only if an active player gets injured.'}
        {y.settings.tiredness_multipliers.length > 0 && <> Starting a player again soon tires them: {
          y.settings.tiredness_multipliers.map((m, i) => `×${fmt(m)} ${i === 0 ? 'the next game' : `${i + 1} games later`}`).join(', ')}.</>}
      </small></p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

function Notice({ y, side }: { y: LeagueTournament; side: TournamentSide }) {
  const name = (id: string | null) => athleteName(y, id);
  if (!side.notice) return null;
  const who = side.athleteId ? `${name(side.athleteId)} played for you` : 'nobody was left to play (forfeit)';
  const why = { missed: "You didn't pick", injured: `${name(side.picked)} was injured`, inactive: `${name(side.picked)} was on your bench` }[side.notice];
  return <p className="notice">{why}, so {who}.</p>;
}

function Standings({ y, membershipId }: { y: LeagueTournament; membershipId: string }) {
  return (
    <div className="section">
      <h3>Standings</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Team</th><th scope="col">Place</th><th scope="col">W-L-T</th><th scope="col">Points</th></tr></thead>
          <tbody>
            {y.result.standings.map((r) => (
              <tr key={r.membershipId} aria-current={r.membershipId === membershipId ? 'true' : undefined}>
                <td>{r.membershipId === membershipId ? <strong>{y.team.get(r.membershipId)} (you)</strong> : y.team.get(r.membershipId)}</td>
                <td>{r.tied ? `T${r.place}` : r.place}</td>
                <td>{r.wins}-{r.losses}-{r.ties}</td>
                <td>{fmt(r.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STATUS: Record<GameOutcome['status'], [string, string]> = {
  upcoming: ['Next', 'pill info'],
  live: ['Playing', 'pill ok'],
  pending: ['Waiting on stats', 'pill warn'],
  final: ['Final', 'pill'],
  void: ['Void', 'pill'],
};

function GameRow({ y, g, membershipId }: { y: LeagueTournament; g: GameOutcome; membershipId: string }) {
  const mine = sides(g).find((x) => x?.membershipId === membershipId);
  const [label, cls] = STATUS[g.status];
  return (
    <details className="section">
      <summary>
        <span className="meta">
          Game {g.game.number} · {y.stage.get(g.game.stageId) ?? ''}
          <span className={cls}>{label}</span>
          {mine?.delta != null && <strong className="num">{mine.result === null ? 'Bye' : `${mine.result} ${signed(mine.delta)}`}</strong>}
        </span>
      </summary>
      {g.status === 'void' && <p className="muted">This game's tally was deleted, so it doesn't count: no points, and nobody got tired.</p>}
      {g.status === 'pending' && <p className="muted">Scores appear once this game's stats (and every earlier game's) lock.</p>}
      {g.status !== 'void' && g.matchups.map((m) => (
        <div key={m.home.membershipId} className="stack">
          <SideDetail y={y} g={g} side={m.home} />
          {m.away ? <SideDetail y={y} g={g} side={m.away} /> : <p className="muted">Bye</p>}
        </div>
      ))}
    </details>
  );
}

/** A line's points, with the tournament multiplier (×2) that every game score carries alike. */
const raw = (y: LeagueTournament, stats: Record<string, number>) =>
  (y.settings.session_multipliers.tournament ?? 1) * rawScore(stats, y.settings.stat_weights);

function SideDetail({ y, g, side }: { y: LeagueTournament; g: GameOutcome; side: TournamentSide }) {
  const line = side.athleteId === null ? undefined
    : y.input.statLines.find((l) => l.sessionId === g.game.sessionId && l.athleteId === side.athleteId);
  const factors = [
    side.tired !== null && side.tired !== 1 ? ` × ${fmt(side.tired)} tired` : '',
    side.decay !== null && side.decay !== 1 ? ` × ${fmt(side.decay)} earlier tournaments` : '',
  ].join('');
  return (
    <div className="stack">
      <p className="head">
        <span><strong>{y.team.get(side.membershipId)}</strong> · {side.athleteId ? y.athlete.get(side.athleteId) : 'forfeit'}</span>
        {side.score !== null && <span className="num">{fmt(side.score)} {side.delta !== null && <>({signed(side.delta)})</>}</span>}
      </p>
      <Notice y={y} side={side} />
      {side.score !== null && side.athleteId !== null && (
        <ul className="list">
          <li>
            <small>{line ? Object.entries(line.stats).filter(([, n]) => n).map(([k, n]) => `${n} ${statLabel(k)}`).join(', ') || 'No stats'
              : `Didn't play: ${fmt(y.settings.absent_score)}`}</small>
            {line && <span className="num">{fmt(raw(y, line.stats))}</span>}
          </li>
          <li>
            <span>Game score{factors}</span>
            <strong className="num">{fmt(side.athleteScore!)}{factors && <>{factors.replace(/ tired| earlier tournaments/g, '')} = {fmt(side.score)}</>}</strong>
          </li>
        </ul>
      )}
    </div>
  );
}
