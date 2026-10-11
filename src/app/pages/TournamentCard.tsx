import { Fragment, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { rawScore } from '../../core/scoring';
import type { GameOutcome, NextGame, TournamentSide } from '../../core/tournament';
import { Loading } from '../components/Loading';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { formatDay, gameLabel, statLabel } from '../lib/stats';
import {
  countLeagues, loadLeagueTournament, loadSeasonStandings, mergeStandings, type LeagueTournament, type OverallStanding,
} from '../lib/tournament';
import { useLoad } from '../lib/useLoad';

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(Math.abs(n))}`;
/** 2–1, or 2–1–1 with ties. */
const record = (r: { wins: number; losses: number; ties: number }) => `${r.wins}–${r.losses}${r.ties ? `–${r.ties}` : ''}`;
/** An athlete's name, or `none` when nobody plays. */
const athleteName = (y: LeagueTournament, id: string | null, none = 'nobody') => (id ? y.athlete.get(id) ?? 'A player' : none);
const sides = (g: GameOutcome) => g.matchups.flatMap((m) => [m.home, m.away]);
const opponentIn = (g: GameOutcome, membershipId: string): TournamentSide | null | undefined => {
  const m = g.matchups.find((x) => x.home.membershipId === membershipId || x.away?.membershipId === membershipId);
  if (!m) return undefined; // not in this game
  return m.home.membershipId === membershipId ? m.away : m.home;
};

/**
 * One team on the League tab, in the order a manager needs it: the matchup headline, what to do now (the next pick,
 * then `children`: the auction), `money` (the Credits card), the standings, then the games played as cards.
 * Standings show all season, between tournaments too.
 */
export function TournamentCard({ membershipId, leagueId, leagueName, seasonId, teamName, subtitle, money, children }: {
  membershipId: string; leagueId: string; leagueName: string; seasonId: string; teamName: string; subtitle: string;
  money?: ReactNode; children?: ReactNode;
}) {
  const { data, error, reload } = useLoad(() => loadLeagueTournament(seasonId, leagueId), [seasonId, leagueId]);
  if (!data) {
    return (
      <>
        <div className="matchup"><h2 className="display">{teamName}</h2><p className="strip">{subtitle}</p></div>
        {children}
        {money}
        {error ? <p className="error" role="alert">{error}</p> : <Loading />}
      </>
    );
  }
  const { games, next } = data.result;
  const played = [...games].reverse().filter((g) => g.status === 'pending' || g.status === 'final' || g.status === 'void');

  return (
    <>
      <Matchup y={data} membershipId={membershipId} teamName={teamName} subtitle={subtitle} />
      {next && (
        <article className="card" aria-label="Next game">
          <PickGame key={`${next.stageId}:${next.number}`} y={data} next={next} membershipId={membershipId} onSaved={reload} />
        </article>
      )}
      {children}
      {money}
      <Standings y={data} membershipId={membershipId} leagueId={leagueId} leagueName={leagueName} seasonId={seasonId} error={error} />
      {played.length > 0 && (
        <section className="stack" aria-label={`${teamName} games`}>
          <h2>Games</h2>
          <div className="games">
            {played.map((g) => <GameCard key={g.game.id} y={data} g={g} membershipId={membershipId} />)}
          </div>
        </section>
      )}
    </>
  );
}

/** "vs Duke" once a keeper names game `number`'s real opponent, else "Game 3". */
const labelOf = (y: LeagueTournament, stageId: string, number: number) =>
  gameLabel(number, y.result.games.find((g) => g.game.stageId === stageId && g.game.number === number)?.game.opponent);

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

function Matchup({ y, membershipId, teamName, subtitle }: {
  y: LeagueTournament; membershipId: string; teamName: string; subtitle: string;
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
  // Before any game counts, Place / Record / Points would read T1 / 0–0 / 0: say so in the strip instead (t228).
  const anyPlayed = y.result.standings.some((r) => r.wins + r.losses + r.ties > 0);
  // Before a game starts the scorer's auto-pick is a guess, so show only the manager's own pick.
  const minePlayer = status === 'upcoming' ? mine?.picked ?? null : mine?.athleteId ?? null;
  // A pick that won't play (injured, or moved to the bench) must not look all set up here.
  const doomed = status === 'upcoming' && minePlayer !== null && (mine?.notice === 'injured' || mine?.notice === 'inactive');

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
            <span>{labelOf(y, focus.stageId, focus.number)}</span>
            {them === null ? <span>Bye</span> : <>
              {status === 'live' && <span className="live"><span className="dot" aria-hidden="true" />Live</span>}
              {status === 'upcoming' && <span>Next up</span>}
              {status === 'pending' && <span>Waiting on stats</span>}
              {final && mine?.result && <strong>{RESULT[mine.result]} {signed(mine.delta ?? 0)}</strong>}
            </>}
            {doomed && <span className="pill warn">{mine?.notice === 'injured' ? 'Your pick is injured' : 'Your pick is on the bench'}</span>}
          </> : <>
            <span>{subtitle}</span>
            <span>{y.result.standings.length} {y.result.standings.length === 1 ? 'team' : 'teams'}</span>
            {!anyPlayed && <span>No games yet</span>}
          </>}
        </p>
      </div>
      {g && them && mine && (
        <div className="score">
          <ScoreSide label={status === 'upcoming' ? 'Your pick' : 'You played'} y={y} athleteId={minePlayer}
            picked={status === 'upcoming' && minePlayer !== null && !doomed}
            score={final ? mine.score : null} empty={status === 'upcoming' ? 'No pick yet' : 'Forfeit'} lost={final && mine.result === 'L'} />
          <span className="vs">{final ? 'to' : 'vs'}</span>
          <ScoreSide label={status === 'upcoming' ? 'Their pick' : 'They played'} y={y}
            athleteId={status === 'upcoming' ? null : them.athleteId} score={final ? them.score : null}
            empty={status === 'upcoming' ? 'Hidden' : 'Forfeit'} lost={final && mine.result === 'W'} />
        </div>
      )}
      {mine && status !== 'upcoming' && <Notice y={y} side={mine} />}
      {anyPlayed && (
        <dl className="tiles">
          <div><dt>Place</dt><dd><span className="big">{row ? `${row.tied ? 'T' : ''}${row.place}` : '–'}</span> <span className="of">of {y.result.standings.length}</span></dd></div>
          <div><dt>Record</dt><dd className="big">{row ? record(row) : '–'}</dd></div>
          <div><dt>Points</dt><dd className="big">{row ? fmt(row.points) : '–'}</dd></div>
        </dl>
      )}
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
  const title = `${labelOf(y, next.stageId, next.number)} · ${y.stage.get(next.stageId) ?? ''}`;
  if (!mine) {
    return <div className="stack"><h2>{title}</h2><p className="muted">You have no players this tournament, so you forfeit each game you're paired in.</p></div>;
  }
  const paired = y.result.games.find((g) => g.game.stageId === next.stageId && g.game.number === next.number);
  const them = paired ? opponentIn(paired, membershipId) : undefined;
  if (paired && them === undefined) {
    return <div className="stack"><h2>{title}</h2><p className="muted">You joined after this game was paired. You'll play from the next game.</p></div>;
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
      <h2>{title}</h2>
      <p>
        {them ? <>You play <strong>{y.team.get(them.membershipId)}</strong>. Picks lock when the game starts.</>
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
        {started ? 'The bench comes in only for an injury, once per tournament.' : 'Set your bench before game 1. It plays only for an injury.'}
        {' '}<Link to="/rules">How it works</Link>
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

/**
 * The league's standings as a ranked list. While the season has 2+ leagues, a toggle swaps in every team of the
 * season ranked together (t223, t226); that view loads on first use and reuses this league's data.
 */
function Standings({ y, membershipId, leagueId, leagueName, seasonId, error }: {
  y: LeagueTournament; membershipId: string; leagueId: string; leagueName: string; seasonId: string; error: string | null;
}) {
  const [all, setAll] = useState(false);
  const [wanted, setWanted] = useState(false); // stays true once asked for, so toggling back doesn't refetch
  const leagues = useLoad(() => countLeagues(seasonId), [seasonId]);
  const season = useLoad(async () => (wanted ? loadSeasonStandings(seasonId, { leagueId, y }) : undefined), [wanted, seasonId, leagueId]);
  const rows = all ? season.data : mergeStandings([{ name: leagueName, y }]);
  return (
    <article className="card" aria-label="Standings">
      <div className="head">
        <h2>Standings</h2>
        {(leagues.data ?? 0) > 1 && (
          <div className="segmented" role="group" aria-label="Standings for">
            <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>{leagueName}</button>
            <button type="button" aria-pressed={all} onClick={() => { setAll(true); setWanted(true); }}>All leagues</button>
          </div>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {rows ? <RankList key={String(all)} rows={rows} membershipId={membershipId} showLeague={all} />
        : season.error ? <p className="error" role="alert">{season.error}</p> : <Loading />}
    </article>
  );
}

/**
 * Ranked rows: place, team (league and record under it), points. Before any game counts it's just the teams (t236).
 * A long list shows the top 5 (with everyone tied with 5th) and your row, if that hides at least 4 teams.
 */
function RankList({ rows, membershipId, showLeague }: { rows: OverallStanding[]; membershipId: string; showLeague: boolean }) {
  const [open, setOpen] = useState(false);
  if (rows.every((r) => r.wins + r.losses + r.ties === 0)) {
    return (
      <ul className="names">
        {rows.map((r) => (
          <li key={r.membershipId} aria-current={r.membershipId === membershipId ? 'true' : undefined}>
            {r.team}{r.membershipId === membershipId && ' (you)'}{showLeague && <small>{r.league}</small>}
          </li>
        ))}
      </ul>
    );
  }
  const top = rows.filter((r) => r.place <= rows[Math.min(4, rows.length - 1)].place || r.membershipId === membershipId);
  const cut = !open && rows.length - top.length >= 4;
  const shown = cut ? top : rows;
  return (
    <>
      <ol className="ranks">
        {shown.map((r, i) => {
          const me = r.membershipId === membershipId;
          const skipped = i > 0 ? rows.indexOf(r) - rows.indexOf(shown[i - 1]) - 1 : 0;
          return (
            <Fragment key={r.membershipId}>
              {skipped > 0 && <li className="gap"><span aria-hidden="true">···</span><span className="sr-only">{skipped} more teams</span></li>}
              <li aria-current={me ? 'true' : undefined}>
                <span className="rank">{r.tied ? 'T' : ''}{r.place}</span>
                <span className="who">
                  <strong>{r.team}{me && ' (you)'}</strong>
                  <small>{showLeague && `${r.league} · `}{record(r)}</small>
                </span>
                <span className="points">{fmt(r.points)}<span className="sr-only"> points</span></span>
              </li>
            </Fragment>
          );
        })}
      </ol>
      {cut && <button type="button" className="secondary" onClick={() => setOpen(true)}>Show all {rows.length} teams</button>}
    </>
  );
}

const STATUS: Record<GameOutcome['status'], [string, string]> = {
  upcoming: ['Next', 'pill info'],
  live: ['Playing', 'pill ok'],
  pending: ['Waiting on stats', 'pill warn'],
  final: ['Final', 'pill'],
  void: ['Void', 'pill'],
};

/** A played game as a card: your matchup as a small scoreboard with the caption below it; opens to every matchup. */
function GameCard({ y, g, membershipId }: { y: LeagueTournament; g: GameOutcome; membershipId: string }) {
  const mine = sides(g).find((x) => x?.membershipId === membershipId);
  const them = opponentIn(g, membershipId); // undefined = not in this game, null = bye
  const [label, cls] = STATUS[g.status];
  return (
    <details className="game">
      <summary>
        <span className="game-score">
          {!mine || them === undefined ? <span className="game-team">Not playing</span>
            : them === null ? <span className="game-team">Bye</span>
              : <>
                <GameSide y={y} side={mine} lost={mine.result === 'L'} />
                <span className="vs">{g.status === 'final' ? 'to' : 'vs'}</span>
                <GameSide y={y} side={them} lost={mine.result === 'W'} />
              </>}
        </span>
        <span className="meta">
          {gameLabel(g.game.number, g.game.opponent)} · {y.stage.get(g.game.stageId) ?? ''}
          <span className={cls}>{label}</span>
          {mine?.delta != null && <strong className="num">{mine.result === null ? 'Bye' : `${mine.result} ${signed(mine.delta)}`}</strong>}
        </span>
      </summary>
      <div className="card">
        {g.status === 'void' && <p className="muted">This game's tally was deleted, so it doesn't count: no points, and nobody got tired.</p>}
        {g.status !== 'void' && g.matchups.map((m) => (
          <div key={m.home.membershipId} className="stack">
            <SideDetail y={y} g={g} side={m.home} />
            {m.away ? <SideDetail y={y} g={g} side={m.away} /> : <p className="muted">Bye</p>}
          </div>
        ))}
      </div>
    </details>
  );
}

/** One team on a game card's scoreboard: its name, and its score once the game is final. */
function GameSide({ y, side, lost }: { y: LeagueTournament; side: TournamentSide; lost: boolean }) {
  return (
    <span className={lost ? 'game-side lost' : 'game-side'}>
      <span className="game-team">{y.team.get(side.membershipId)}</span>
      {side.score !== null && <span className="pts">{fmt(side.score)}</span>}
    </span>
  );
}

/** "Christopher Mao by (T) Test Zeal": who played, and for whose team. */
function ByLine({ player, team }: { player: string; team: string }) {
  return (
    <span className="by">
      {player} <small>by</small> <span className="avatar sm" aria-hidden="true">{team.trim().charAt(0).toUpperCase()}</span>{' '}
      <strong>{team}</strong>
    </span>
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
        <ByLine player={side.athleteId ? y.athlete.get(side.athleteId) ?? 'A player' : 'Forfeit'} team={y.team.get(side.membershipId) ?? 'A team'} />
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
