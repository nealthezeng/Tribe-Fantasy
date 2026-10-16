import { Fragment, useState, type ReactNode } from 'react';
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
/** Two significant figures, so a sliver of a share never reads 0: 0.45, 0.0033. */
const sig = (n: number) => Number(n.toPrecision(2));
/** 67%; under 1% keeps one significant figure, so a sliver never reads 0%. */
const pct = (share: number) => `${share < 0.01 ? Number((share * 100).toPrecision(1)) : Math.round(share * 100)}%`;
const sides = (g: GameOutcome) => g.matchups.flatMap((m) => [m.home, m.away]);
const opponentIn = (g: GameOutcome, membershipId: string): TournamentSide | null | undefined => {
  const m = g.matchups.find((x) => x.home.membershipId === membershipId || x.away?.membershipId === membershipId);
  if (!m) return undefined; // not in this game
  return m.home.membershipId === membershipId ? m.away : m.home;
};

/**
 * One team on the League tab, in the order a manager needs it: the matchup headline, what to do now (the next pick,
 * then `children`: the auction), the standings, then the games played as cards.
 * Standings show all season, between tournaments too.
 */
export function TournamentCard({ membershipId, leagueId, leagueName, seasonId, teamName, subtitle, children }: {
  membershipId: string; leagueId: string; leagueName: string; seasonId: string; teamName: string; subtitle: string;
  children?: ReactNode;
}) {
  const { data, error, reload } = useLoad(() => loadLeagueTournament(seasonId, leagueId), [seasonId, leagueId]);
  if (!data) {
    return (
      <>
        <div className="matchup"><h2 className="display">{teamName}</h2><p className="strip">{subtitle}</p></div>
        {children}
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
  const upcoming = status === 'upcoming';
  // Before a game starts the scorer's auto-picks are a guess, so show only the manager's own picks.
  const minePlayers = !mine ? [] : upcoming ? mine.picked : mine.athleteIds;
  // A pick that won't play (injured, with someone free to replace them) must not look all set up here.
  const doomed = upcoming && !!mine && mine.replacements.some((r) => r.picked !== null && !mine.athleteIds.includes(r.picked));
  const wanted = mine ? Math.min(y.settings.picks_per_game, mine.players.length) : 0;

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
            {doomed && <span className="pill warn">Your pick is injured</span>}
          </> : <>
            <span>{subtitle}</span>
            <span>{y.result.standings.length} {y.result.standings.length === 1 ? 'team' : 'teams'}</span>
            {!anyPlayed && <span>No games yet</span>}
          </>}
        </p>
      </div>
      {g && them && mine && (
        <div className="score">
          <ScoreSide label={upcoming ? 'Your picks' : 'You played'} y={y} athleteIds={minePlayers}
            picked={upcoming && wanted > 0 && minePlayers.length >= wanted && !doomed}
            score={final ? mine.score : null} empty={upcoming ? 'No picks yet' : 'Forfeit'} lost={final && mine.result === 'L'} />
          <span className="vs">{final ? 'to' : 'vs'}</span>
          <ScoreSide label={upcoming ? 'Their picks' : 'They played'} y={y}
            athleteIds={upcoming ? [] : them.athleteIds} score={final ? them.score : null}
            empty={upcoming ? 'Hidden' : 'Forfeit'} lost={final && mine.result === 'W'} />
        </div>
      )}
      {mine && !upcoming && <Notice y={y} side={mine} played />}
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

function ScoreSide({ label, y, athleteIds, score, empty, lost = false, picked = false }: {
  label: string; y: LeagueTournament; athleteIds: string[]; score: number | null; empty: string; lost?: boolean;
  /** Your picks are set for the next game: shown in green. */
  picked?: boolean;
}) {
  // First names: two of them share half a phone-wide scoreboard. The pick card has the full names.
  const names = athleteIds.length === 0 ? empty : athleteIds.map((a) => <span key={a}>{athleteName(y, a).split(' ')[0]}</span>);
  return (
    <div className={['score-side', lost && 'lost', picked && 'picked'].filter(Boolean).join(' ')}>
      <small>{label}</small>
      {score !== null ? <><span className="pts">{fmt(score)}</span><strong className="names">{names}</strong></>
        : <span className="pts-name names">{names}</span>}
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
    return <div className="stack"><h2>{title}</h2><p className="muted">No players: you forfeit.</p></div>;
  }
  const paired = y.result.games.find((g) => g.game.stageId === next.stageId && g.game.number === next.number);
  const them = paired ? opponentIn(paired, membershipId) : undefined;
  if (paired && them === undefined) {
    return <div className="stack"><h2>{title}</h2><p className="muted">You start next game.</p></div>;
  }
  const n = y.settings.picks_per_game;
  const wanted = Math.min(n, mine.players.length);
  const full = mine.picked.length >= n;
  const byName = (a: string, b: string) => name(a).localeCompare(name(b));

  /** Saves the whole set: set_game_pick replaces the team's picks for this game. */
  async function save(athleteIds: string[]) {
    setBusy(true);
    setError(null);
    try {
      await api.setGamePick(membershipId, next.stageId, next.number, athleteIds);
    } catch (err) {
      setError(errorMessage(err, String(n)));
    }
    setBusy(false);
    onSaved(); // a refused pick usually means the game just started: show it
  }

  return (
    <div className="stack">
      <h2>{title}</h2>
      <p>
        {them ? <>You play <strong>{y.team.get(them.membershipId)}</strong>.</>
          : them === null ? 'You have a bye this game.'
            : 'Opponent TBD.'}
      </p>
      <Notice y={y} side={mine} />
      <p className="count-line"><span>Pick {wanted}</span><strong>{mine.picked.length} of {wanted}</strong></p>
      <ul className="list">
        {[...mine.players].sort(byName).map((id) => (
          <li key={id} className="pickrow">
            <span className="who">
              <span><span className="title">{name(id)}</span>{y.injured.has(id) && <> <span className="pill bad">Injured</span></>}</span>
              <Factor side={mine} id={id} />
            </span>
            {mine.picked.includes(id) ? (
              <button className="secondary picked" aria-pressed="true" disabled={busy}
                onClick={() => void save(mine.picked.filter((a) => a !== id))}>
                <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M2.5 7.5l3 3 6-7" /></svg>
                Your pick <span className="clear">· Clear</span>
              </button>
            ) : (
              <button aria-label={`Pick ${name(id)}`} disabled={busy || full} onClick={() => void save([...mine.picked, id])}>Pick</button>
            )}
          </li>
        ))}
      </ul>
      {full && mine.players.length > mine.picked.length && <p className="hint">You have {n} picks. Clear one to change.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** What a player's points count for this game (decision 11): one number, its parts one tap away. The core multiplies. */
function Factor({ side, id }: { side: TournamentSide; id: string }) {
  return (
    <details className="factor">
      <summary aria-label={`Counts ×${sig(side.factor[id])}`}>×{sig(side.factor[id])}</summary>
      <p className="parts">
        <span><b>{pct(side.share[id])}</b> share</span>
        {side.rest[id] < 1 ? <span><b>×{sig(side.rest[id])}</b> tired</span> : <span><b>×1</b> rested</span>}
        {side.decay[id] !== 1 && <span><b>×{sig(side.decay[id])}</b> earlier tournaments</span>}
      </p>
    </details>
  );
}

/**
 * Why a starter isn't the team's own pick: each injured pick, then who fills the picks left empty. An injured pick with
 * nobody healthy free to replace them plays anyway (the core lists them as their own replacement): not a swap.
 */
function Notice({ y, side, played = false }: { y: LeagueTournament; side: TournamentSide; played?: boolean }) {
  const name = (id: string | null) => athleteName(y, id);
  const lines = side.replacements.flatMap(({ picked, athleteId }) => {
    if (picked === null) return [];
    if (side.athleteIds.includes(picked)) {
      return [played ? `${name(picked)} was injured and played: nobody else was free.` : `${name(picked)} is injured and still plays: nobody else is free.`];
    }
    return [played ? `${name(picked)} was injured, so ${name(athleteId)} played.` : `${name(picked)} is injured. ${name(athleteId)} plays.`];
  });
  const fill = side.replacements.flatMap((r) => (r.picked === null && r.athleteId !== null ? [name(r.athleteId)] : []));
  if (fill.length > 0) {
    const who = fill.join(' and ');
    lines.push(played ? `You didn't pick, so ${who} played.` : `If you don't pick, ${who} ${fill.length === 1 ? 'plays' : 'play'}.`);
  }
  return <>{lines.map((t) => <p key={t} className="notice">{t}</p>)}</>;
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
 * Ranked rows: place, team (league and record under it), points; a leaderboard from day one, all tied at first (t239).
 * A long list shows the top 5 (with everyone tied with 5th) and your row, if that hides at least 4 teams.
 */
function RankList({ rows, membershipId, showLeague }: { rows: OverallStanding[]; membershipId: string; showLeague: boolean }) {
  const [open, setOpen] = useState(false);
  const top = rows.filter((r) => r.place <= (rows[Math.min(4, rows.length - 1)]?.place ?? 0) || r.membershipId === membershipId);
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
              {skipped > 0 && <li className="gap"><span aria-hidden="true">···</span><span className="sr-only">{skipped} more {skipped === 1 ? 'team' : 'teams'}</span></li>}
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
        {g.status === 'void' && <p className="muted">Doesn't count.</p>}
        {g.status !== 'void' && g.matchups.map((m) => (
          <div key={m.home.membershipId} className="stack">
            <SideDetail y={y} g={g} side={m.home} />
            {m.away ? <SideDetail y={y} g={g} side={m.away} /> : <p className="muted">Bye</p>}
          </div>
        ))}
        {g.status === 'final' && <p className="hint">× is share × tired × earlier tournaments.</p>}
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

/** One team's side of an opened game: each starter as "name · stats" and, once final, "game score × factor = points". */
function SideDetail({ y, g, side }: { y: LeagueTournament; g: GameOutcome; side: TournamentSide }) {
  const statsOf = (a: string) => {
    const line = y.input.statLines.find((l) => l.sessionId === g.game.sessionId && l.athleteId === a);
    return line ? Object.entries(line.stats).filter(([, n]) => n).map(([k, n]) => `${n} ${statLabel(k)}`).join(', ') || 'No stats'
      : "Didn't play";
  };
  return (
    <div className="stack">
      <p className="head">
        <span className="by">{y.team.get(side.membershipId) ?? 'A team'}</span>
        {side.score !== null && <span className="num">{fmt(side.score)} {side.delta !== null && <>({signed(side.delta)})</>}</span>}
      </p>
      <Notice y={y} side={side} played />
      {side.athleteIds.length === 0 ? <p className="muted">Forfeit</p> : (
        <ul className="list">
          {side.athleteIds.map((a) => (
            <li key={a}>
              <small>{athleteName(y, a)}{side.points && ` · ${statsOf(a)}`}</small>
              {side.points && side.athleteScores && (
                <strong className="num calc">{fmt(side.athleteScores[a])} × {sig(side.factor[a])} = {fmt(side.points[a])}</strong>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
