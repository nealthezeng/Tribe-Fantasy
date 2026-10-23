import { useLayoutEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { GameOutcome, NextGame, TournamentSide } from '../../core/tournament';
import { FactorHelp, VerifiedHelp } from '../components/Help';
import { Loading } from '../components/Loading';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { changes, readSeen, seenKey, writeSeen } from '../lib/seen';
import { formatDay, statLabel } from '../lib/stats';
import type { Seen } from '../lib/seen';
import { anyCounted, fmt, loadLeagueTournament, record, type LeagueTournament } from '../lib/tournament';
import { useLoad, usePoll } from '../lib/useLoad';
import { pct } from '../lib/wallet';
import { factorWords, gameName } from '../lib/words';

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(Math.abs(n))}`;
/** An athlete's name, or `none` when nobody plays. */
const athleteName = (y: LeagueTournament, id: string | null, none = 'nobody') => (id ? y.athlete.get(id) ?? 'A player' : none);
/** Two significant figures, so a sliver of a share never reads 0: 0.45, 0.0033. */
const sig = (n: number) => Number(n.toPrecision(2));
const sides = (g: GameOutcome) => g.matchups.flatMap((m) => [m.home, m.away]);
const opponentIn = (g: GameOutcome, membershipId: string): TournamentSide | null | undefined => {
  const m = g.matchups.find((x) => x.home.membershipId === membershipId || x.away?.membershipId === membershipId);
  if (!m) return undefined; // not in this game
  return m.home.membershipId === membershipId ? m.away : m.home;
};

/**
 * One team on the League tab, in the order a manager needs it: the matchup headline, what to do now (the next pick,
 * then `children`: the auction), then the games played as cards. The standings are on the Leaderboards tab.
 */
export function TournamentCard({ membershipId, leagueId, seasonId, teamName, subtitle, children }: {
  membershipId: string; leagueId: string; seasonId: string; teamName: string; subtitle: string;
  children?: ReactNode;
}) {
  const { data, error, reload } = useLoad(() => loadLeagueTournament(seasonId, leagueId, { live: true }), [seasonId, leagueId]);
  // Live (or finished-but-unverified) paired games change under us: refresh every 15 s while any exists.
  usePoll(reload, !!data?.result.games.some((g) => (g.status === 'live' || g.status === 'pending') && g.matchups.length > 0));
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
      {error && <p className="error" role="alert">{error}</p>}
      {next && (
        <article className="card" aria-label="Next game">
          <PickGame key={`${next.stageId}:${next.number}`} y={data} next={next} membershipId={membershipId} onSaved={reload} />
        </article>
      )}
      {children}
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

/** "Game 3 vs Duke" once a keeper names game `number`'s real opponent, else "Game 3". */
const labelOf = (y: LeagueTournament, stageId: string, number: number) =>
  gameName(number, y.result.games.find((g) => g.game.stageId === stageId && g.game.number === number)?.game.opponent);

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

/** A team name in the headline, its owner in small text under it (nothing when the account has no profile). */
const HeadSide = ({ id, name, owner }: { id: string; name?: string; owner?: string }) => (
  <span className="side"><Link className="team-link" to={`/team/${id}`}>{name}</Link>{owner && <> <small className="owner">{owner}</small></>}</span>
);

const RESULT = { W: 'Won', L: 'Lost', T: 'Tied' } as const;

function Matchup({ y, membershipId, teamName, subtitle }: {
  y: LeagueTournament; membershipId: string; teamName: string; subtitle: string;
}) {
  const focus = focusGame(y, membershipId);
  const g = focus?.g ?? null;
  const status = g?.status ?? 'upcoming'; // labels keep the official status; only the numbers below are unofficial
  const final = status === 'final';
  const shown = g && (y.unofficial.get(g.game.id) ?? g);
  const unofficial = shown !== g;
  const mine = shown ? sides(shown).find((x) => x?.membershipId === membershipId) ?? null
    : y.result.next?.sides.find((x) => x.membershipId === membershipId) ?? null;
  const them = shown ? opponentIn(shown, membershipId) : undefined; // undefined = not paired yet, null = bye
  const dates = focus && y.stageDates.get(focus.stageId);
  const row = y.result.standings.find((r) => r.membershipId === membershipId);
  // Before any game counts, Place / Record / Points would read T1 / 0–0 / 0: say so in the strip instead (t228).
  const anyPlayed = anyCounted(y);
  const upcoming = status === 'upcoming';
  // Before a game starts the scorer's auto-picks are a guess, so show only the manager's own picks.
  const minePlayers = !mine ? [] : upcoming ? mine.picked : mine.athleteIds;
  // A pick that won't play (out, with someone free to replace them) must not look all set up here.
  const doomed = upcoming && !!mine && mine.replacements.some((r) => r.picked !== null && r.athleteId !== r.picked);
  const wanted = mine ? Math.min(y.settings.picks_per_game, mine.players.length) : 0;

  // Since you last looked (t319): after each load, compare what this device last saw with what is shown now.
  const key = g && !upcoming && mine && them ? seenKey(membershipId, g.game.id) : null;
  const [since, setSince] = useState<{ key: string; chips: NonNullable<ReturnType<typeof changes>>; from: Seen } | null>(null);
  useLayoutEffect(() => {
    if (!key || !mine || !them) return;
    const cur: Seen = { mine: mine.score, them: them.score, points: { mine: mine.points ?? {}, them: them.points ?? {} } };
    const prev = readSeen(key);
    const chips = changes(prev, cur);
    if (prev && chips) setSince({ key, chips, from: prev }); // no change: the chips from the last change stay
    writeSeen(key, cur);
  }, [key, mine, them]);
  const now = since?.key === key ? since : null;

  return (
    <>
      <div className="matchup">
        <h2 className="display">
          {them ? <>
            <HeadSide id={membershipId} name={teamName} owner={y.owner.get(membershipId)} />
            {' '}<span className="vs">vs</span>{' '}
            <HeadSide id={them.membershipId} name={y.team.get(them.membershipId)} owner={y.owner.get(them.membershipId)} />
          </> : teamName}
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
              {unofficial && <><span className="pill warn">Unofficial</span><VerifiedHelp hours={y.settings.stat_lock_hours} /></>}
              {final && mine?.result && <strong>{RESULT[mine.result]} {signed(mine.delta ?? 0)}</strong>}
            </>}
            {doomed && <span className="pill warn">Your pick is out</span>}
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
            score={mine.score} from={now?.from.mine} empty={upcoming ? 'No picks yet' : 'Forfeit'} lost={final && mine.result === 'L'} />
          <span className="vs">{final ? 'to' : 'vs'}</span>
          <ScoreSide label={upcoming ? 'Their picks' : 'They played'} y={y}
            athleteIds={upcoming ? [] : them.athleteIds} score={them.score} from={now?.from.them}
            empty={upcoming ? 'Hidden' : 'Forfeit'} lost={final && mine.result === 'W'} />
        </div>
      )}
      {mine && !upcoming && <Notice y={y} side={mine} played />}
      {shown && them && mine && !upcoming && (
        <section className="card starters" aria-label="Starters">
          <StarterSide y={y} g={shown} side={mine} name={teamName} since={now?.chips.mine} />
          <StarterSide y={y} g={shown} side={them} name={y.team.get(them.membershipId) ?? 'A team'} since={now?.chips.them} />
        </section>
      )}
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

/** A score that counts from `from` to `value` over --dur-count; at once on reduced motion, with no `from`, or in jsdom. */
function CountUp({ value, from }: { value: number; from: number | null }) {
  const [shown, setShown] = useState(value);
  useLayoutEffect(() => {
    const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-count'));
    if (from === null || from === value || !(ms > 0) || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      setShown(from + (value - from) * k);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    setShown(from);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, from]);
  return <>{fmt(shown)}</>;
}

function ScoreSide({ label, y, athleteIds, score, from, empty, lost = false, picked = false }: {
  label: string; y: LeagueTournament; athleteIds: string[]; score: number | null; empty: string; lost?: boolean;
  /** The score this device last saw, when it has changed since: the number counts up from it. */
  from?: number | null;
  /** Your picks are set for the next game: shown in green. */
  picked?: boolean;
}) {
  // First names: two of them share half a phone-wide scoreboard. The pick card has the full names.
  const names = athleteIds.length === 0 ? empty : athleteIds.map((a) => <span key={a}>{athleteName(y, a).split(' ')[0]}</span>);
  return (
    <div className={['score-side', lost && 'lost', picked && 'picked'].filter(Boolean).join(' ')}>
      <small>{label}</small>
      {score !== null ? <><span className="pts"><CountUp value={score} from={from ?? null} /></span><strong className="names">{names}</strong></>
        : <span className="pts-name names">{names}</span>}
    </div>
  );
}

function PickGame({ y, next, membershipId, onSaved }: {
  y: LeagueTournament; next: NextGame; membershipId: string; onSaved: () => Promise<void>;
}) {
  // The set being saved: shown as picked from the tap until the reload after the save lands. The loaded picks are
  // stale until then, so taps meanwhile are held: a set built from them would drop this one.
  const [saving, setSaving] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string | null) => athleteName(y, id);
  const mine = next.sides.find((x) => x.membershipId === membershipId);
  const game = y.result.games.find((g) => g.game.stageId === next.stageId && g.game.number === next.number);
  const title = gameName(next.number, game?.game.opponent);
  if (!mine) {
    return <div className="stack"><h2>{title}</h2><p className="muted">You have no players this tournament, so you can't score.</p></div>;
  }
  // A game with no matchups isn't paired yet (B1): it gets paired when the game before it finishes, so pick now.
  const paired = game && game.matchups.length > 0 ? game : undefined;
  const them = paired ? opponentIn(paired, membershipId) : undefined;
  if (paired && them === undefined) {
    return <div className="stack"><h2>{title}</h2><p className="muted">You joined after game {next.number} was paired, so you start the game after it.</p></div>;
  }
  const n = y.settings.picks_per_game;
  const wanted = Math.min(n, mine.players.length);
  const picked = saving ?? mine.picked;
  const full = picked.length >= n;
  const byName = (a: string, b: string) => name(a).localeCompare(name(b));
  const lock = `Picks lock when a keeper starts game ${next.number}.`;

  /** Saves the whole set: set_game_pick replaces the team's picks for this game. */
  async function save(athleteIds: string[]) {
    setSaving(athleteIds);
    setError(null);
    try {
      await api.setGamePick(membershipId, next.stageId, next.number, athleteIds);
    } catch (err) {
      setError(errorMessage(err, String(n)));
    }
    await onSaved(); // a refused pick usually means the game just started: show it
    setSaving(null);
  }

  return (
    <div className="stack">
      <div className="head">
        <h2>Pick {wanted} for game {next.number}{game?.game.opponent && ` vs ${game.game.opponent}`}</h2>
        <FactorHelp settings={y.settings} />
        <strong className="num">{picked.length} of {wanted}</strong>
      </div>
      {them ? <>
        <p>You play <strong><Link className="team-link" to={`/team/${them.membershipId}`}>{y.team.get(them.membershipId)}</Link></strong>.</p>
        <p className="hint">{lock}</p>
      </> : them === null ? <>
        <p>Bye in game {next.number}: no opponent, so your standings points don't change.</p>
        <p className="hint">{lock}</p>
      </> : <p className="hint">{next.number > 1 && `You'll see who you play once game ${next.number - 1} ends. `}{lock}</p>}
      {/* The row is the button (ruling 5). Taps during a save and its reload are held, not disabled, so nothing flickers. */}
      <div aria-busy={saving !== null}>
        {[...mine.players].sort(byName).map((id) => {
          const on = picked.includes(id);
          const out = y.out.has(id);
          return (
            <button key={id} className="pick-row" aria-pressed={on} disabled={!on && (full || out)}
              onClick={() => { if (!saving) void save(on ? picked.filter((a) => a !== id) : [...picked, id]); }}>
              <span className="who">
                <b>{name(id)}{out && <> <span className="pill bad">Out</span></>}</b>{' '}
                <small>Your {factorWords(mine, id, next.number, y.settings)}</small>
              </span>
              <span className="ring" aria-hidden="true" />
            </button>
          );
        })}
      </div>
      <Notice y={y} side={mine} />
      {full && mine.players.length > picked.length && <p className="hint">You have {n} picks. Clear one to change.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

/** What a player's points count for this game (decision 11): one number, its parts one tap away. The core multiplies. */
export function Factor({ side, id }: { side: TournamentSide; id: string }) {
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
 * Why a starter isn't the team's own pick: each Out pick, then who fills the picks left empty. An Out pick with
 * nobody else free to replace them plays anyway (the core lists them as their own replacement): not a swap.
 * `team` names another team's side; omitted, the side is the viewer's ("You").
 */
function Notice({ y, side, played = false, team }: { y: LeagueTournament; side: TournamentSide; played?: boolean; team?: string }) {
  const name = (id: string | null) => athleteName(y, id);
  const lines = side.replacements.flatMap(({ picked, athleteId }) => {
    if (picked === null) return [];
    if (athleteId === picked) {
      return [played ? `${name(picked)} was out and played: nobody else was free.` : `${name(picked)} is out and still plays: nobody else is free.`];
    }
    return [played ? `${name(picked)} was out, so ${name(athleteId)} played.` : `${name(picked)} is out. ${name(athleteId)} plays.`];
  });
  const fill = side.replacements.flatMap((r) => (r.picked === null && r.athleteId !== null ? [name(r.athleteId)] : []));
  if (fill.length > 0) {
    const who = fill.join(' and ');
    lines.push(played ? `${team ?? 'You'} didn't pick, so ${who} played.` : `If you don't pick, ${who} ${fill.length === 1 ? 'plays' : 'play'}.`);
  }
  return <>{lines.map((t) => <p key={t} className="hint">{t}</p>)}</>;
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
  const o = y.unofficial.get(g.game.id) ?? g; // sides' numbers; labels keep the official status
  const mine = sides(o).find((x) => x?.membershipId === membershipId);
  const them = opponentIn(o, membershipId); // undefined = not in this game, null = bye
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
          {gameName(g.game.number, g.game.opponent)} · {y.stage.get(g.game.stageId) ?? ''}
          <span className={cls}>{label}</span>
          {o !== g && <span className="pill warn">Unofficial</span>}
          {mine?.delta != null && <strong className="num">{mine.result === null ? 'Bye' : `${mine.result} ${signed(mine.delta)}`}</strong>}
        </span>
      </summary>
      <div className="card">
        {g.status === 'void' && <p className="muted">Doesn't count.</p>}
        {g.status !== 'void' && o.matchups.map((m) => (
          <div key={m.home.membershipId} className="stack">
            <SideDetail y={y} g={g} side={m.home} membershipId={membershipId} />
            {m.away ? <SideDetail y={y} g={g} side={m.away} membershipId={membershipId} /> : <p className="muted">Bye</p>}
          </div>
        ))}
        {g.status === 'final' && <p className="hint">× is share × tired × earlier tournaments.</p>}
        {o !== g && <p className="hint">Unofficial until a keeper verifies.</p>}
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

/** "2 Goal, 1 Assist", "No stats" (a starter nobody has tapped yet) or, in a verified game, "Didn't play". */
function statsOf(y: LeagueTournament, g: GameOutcome, a: string) {
  const line = y.input.statLines.find((l) => l.sessionId === g.game.sessionId && l.athleteId === a);
  return line || g.status !== 'final' ? Object.entries(line?.stats ?? {}).filter(([, n]) => n).map(([k, n]) => `${n} ${statLabel(k)}`).join(', ') || 'No stats'
    : "Didn't play";
}

/** The matchup's starters for one team: its name and score, then each starter's stat line and points. */
function StarterSide({ y, g, side, name, since }: { y: LeagueTournament; g: GameOutcome; side: TournamentSide; name: string; since?: Record<string, number> }) {
  return (
    <div className="stack">
      <p className="head">
        <span className="by">{name}</span>
        {side.score !== null && <span className="num">{fmt(side.score)}</span>}
      </p>
      {side.athleteIds.length === 0 ? <p className="muted">Forfeit</p> : (
        <ul className="list">
          {side.athleteIds.map((a) => (
            <li key={a}>
              <small>{athleteName(y, a)} · {statsOf(y, g, a)}</small>
              {side.points && <strong className="num">{since?.[a] != null && <span className={since[a] > 0 ? 'since up' : 'since down'}>{signed(since[a])}<span className="sr-only"> since you last looked, now </span></span>}{fmt(side.points[a])}</strong>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One team's side of an opened game: each starter as "name · stats" and, once final, "game score × factor = points". */
function SideDetail({ y, g, side, membershipId }: { y: LeagueTournament; g: GameOutcome; side: TournamentSide; membershipId: string }) {
  return (
    <div className="stack">
      <p className="head">
        <span className="by">{y.team.get(side.membershipId) ?? 'A team'}</span>
        {side.score !== null && <span className="num">{fmt(side.score)} {side.delta !== null && <>({signed(side.delta)})</>}</span>}
      </p>
      <Notice y={y} side={side} played team={side.membershipId === membershipId ? undefined : y.team.get(side.membershipId) ?? 'A team'} />
      {side.athleteIds.length === 0 ? <p className="muted">Forfeit</p> : (
        <ul className="list">
          {side.athleteIds.map((a) => (
            <li key={a}>
              <small>{athleteName(y, a)}{side.points && ` · ${statsOf(y, g, a)}`}</small>
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
