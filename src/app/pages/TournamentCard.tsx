import { useLayoutEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { GameOutcome, NextGame, TournamentSide } from '../../core/tournament';
import { FactorHelp, VerifiedHelp } from '../components/Help';
import { Loading } from '../components/Loading';
import { RankList } from '../components/RankList';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { changes, readSeen, seenKey, writeSeen } from '../lib/seen';
import type { Seen } from '../lib/seen';
import { anyCounted, fmt, loadLeagueTournament, mergeStandings, record, type LeagueTournament } from '../lib/tournament';
import { useLoad, usePoll } from '../lib/useLoad';
import { factorWords, gameName, heldNote, pctExact, statusWord, statWords } from '../lib/words';

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
 * One team on the League tab, in the order a manager needs it: the matchup headline, what to do now (the next pick,
 * then `children`: the auction), the league's short table, then the games, one line each, by tournament.
 */
export function TournamentCard({ membershipId, leagueId, seasonId, teamName, subtitle, leagueName, children }: {
  membershipId: string; leagueId: string; seasonId: string; teamName: string; subtitle: string; leagueName: string;
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
  const { next } = data.result;

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
      <LeagueTable y={data} membershipId={membershipId} leagueName={leagueName} />
      <GameList y={data} membershipId={membershipId} teamName={teamName} />
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
  // A verified game held back by an earlier one has its own verified numbers: Final with a note, not unofficial.
  const unofficial = shown !== g && !g?.heldBy;
  const held = g && heldNote(y, g);
  const mine = shown ? sides(shown).find((x) => x?.membershipId === membershipId) ?? null
    : y.result.next?.sides.find((x) => x.membershipId === membershipId) ?? null;
  const them = shown ? opponentIn(shown, membershipId) : undefined; // undefined = not paired yet, null = bye
  // Before any game counts, the strip says so (t228).
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
          {/* Rule 5: the game, then its status as a word (Live with the dot), no pill but the one that needs you. "Next up"
              is the strip's own word for the game to come. */}
          {focus ? <>
            <span>{labelOf(y, focus.stageId, focus.number)}</span>
            {them === null ? <span>Bye</span> : <>
              {status === 'live' ? <span className="live"><span className="dot" aria-hidden="true" />Live</span>
                : <span>{upcoming || !g ? 'Next up' : statusWord(g)}</span>}
              {held && <span>{held}</span>}
              {final && mine?.result && <strong>{RESULT[mine.result]} {signed(mine.delta ?? 0)}</strong>}
              {unofficial && <><span>unofficial</span><VerifiedHelp hours={y.settings.stat_lock_hours} /></>}
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
          <span className="vs">vs</span>
          <ScoreSide label={upcoming ? 'Their picks' : 'They played'} y={y}
            athleteIds={upcoming ? [] : them.athleteIds} score={them.score} from={now?.from.them}
            empty={upcoming ? 'Hidden' : 'Forfeit'} lost={final && mine.result === 'W'} />
        </div>
      )}
      {/* Who the app started for you sits under your starters; with a bye there are none to sit under. */}
      {mine && !upcoming && them === null && <Notice y={y} side={mine} played />}
      {shown && them && mine && !upcoming && (
        <section className="card starters" aria-label="Starters">
          <StarterSide y={y} g={shown} side={mine} name={teamName} since={now?.chips.mine}>
            <Notice y={y} side={mine} played />
          </StarterSide>
          <StarterSide y={y} g={shown} side={them} name={y.team.get(them.membershipId) ?? 'A team'} since={now?.chips.them} />
        </section>
      )}
    </>
  );
}

/** The league's short table (layout A, ruling 8): the top 3 and your neighbours. "Full table" opens Leaderboards. */
function LeagueTable({ y, membershipId, leagueName }: { y: LeagueTournament; membershipId: string; leagueName: string }) {
  const started = anyCounted(y);
  return (
    <article className="card" aria-label={leagueName}>
      <div className="head">
        <h2>{leagueName}</h2>
        {started && <Link className="more" to="/leaderboards">Full table</Link>}
      </div>
      {started ? <RankList rows={mergeStandings([{ name: leagueName, y }])} membershipId={membershipId} showLeague={false} linkable={new Set(y.team.keys())} short />
        : <p className="muted">Standings start after the first game.</p>}
    </article>
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

const byNumber = (a: GameOutcome, b: GameOutcome) => a.game.number - b.game.number;

/**
 * The games (ruling 9): the current tournament (the one `next` is in, else the newest with a started game) with every
 * game on one line, then each earlier tournament this team played in, folded to one row. Nothing before any game.
 */
function GameList({ y, membershipId, teamName }: { y: LeagueTournament; membershipId: string; teamName: string }) {
  const { games, next } = y.result;
  const day = (stageId: string) => y.stageDates.get(stageId)?.starts_on ?? '';
  const started = games.filter((g) => g.status !== 'upcoming');
  const stages = [...new Set(started.map((g) => g.game.stageId))].sort((a, b) => day(b).localeCompare(day(a)));
  const current = next?.stageId ?? stages[0];
  const lines = games.filter((g) => g.game.stageId === current).sort(byNumber);
  const earlier = stages.filter((s) => s !== current)
    .map((s) => started.filter((g) => g.game.stageId === s).sort(byNumber))
    .filter((t) => t.some((g) => opponentIn(g, membershipId) !== undefined));
  if (lines.length === 0 && earlier.length === 0) return null;

  // The next game shows the picks still to make, in gold, until they're in (rule 2); none if this team can't pick it.
  const side = next?.sides.find((x) => x.membershipId === membershipId);
  const left = side ? Math.min(y.settings.picks_per_game, side.players.length) - side.picked.length : 0;
  const pickOf = (g: GameOutcome) => (g.game.stageId === next?.stageId && g.game.number === next.number
    && (g.matchups.length === 0 || opponentIn(g, membershipId) !== undefined) ? left : 0);
  const recordOf = (t: GameOutcome[]) => {
    const mine = t.flatMap((g) => (g.status === 'final' ? sides(g) : [])).filter((x) => x?.membershipId === membershipId);
    const n = (r: TournamentSide['result']) => mine.filter((x) => x?.result === r).length;
    return record({ wins: n('W'), losses: n('L'), ties: n('T') });
  };
  return (
    <section className="card" aria-label={`${teamName} games`}>
      <h2>Games</h2>
      {lines.length > 0 && (
        <div className="game-group">
          <p>{y.stage.get(current ?? '')}</p>
          {lines.map((g) => <GameLine key={g.game.id} y={y} g={g} membershipId={membershipId} pick={pickOf(g)} />)}
        </div>
      )}
      {earlier.length > 0 && (
        <div className="game-group">
          <p>Earlier</p>
          {earlier.map((t) => (
            <details key={t[0].game.stageId}>
              <summary><span>{`${y.stage.get(t[0].game.stageId) ?? ''} · ${t.length} ${t.length === 1 ? 'game' : 'games'} · ${recordOf(t)}`}</span></summary>
              <div className="game-group">{t.map((g) => <GameLine key={g.game.id} y={y} g={g} membershipId={membershipId} />)}</div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One game on one line (rule 4): its number, both teams with scores (yours first), its state as a word ("Live" with
 * the dot), or "Pick {k}" for the next game. A started game opens to its matchups; one not started or void doesn't.
 */
function GameLine({ y, g, membershipId, pick = 0 }: { y: LeagueTournament; g: GameOutcome; membershipId: string; pick?: number }) {
  const o = y.unofficial.get(g.game.id) ?? g; // sides' numbers; the words keep the official status
  const unofficial = o !== g && !g.heldBy; // a held game's numbers are verified (controller ruling 15)
  const mine = sides(o).find((x) => x?.membershipId === membershipId);
  const them = opponentIn(o, membershipId); // null = bye
  const note = [g.game.opponent && `vs ${g.game.opponent}`, heldNote(y, g)].filter(Boolean).join(' · ');
  const team = (s: TournamentSide, lost: boolean) => (
    <span className={lost ? 't lost' : 't'}><span>{y.team.get(s.membershipId) ?? 'A team'}</span>{s.score !== null && <b>{fmt(s.score)}</b>}</span>
  );
  const word = (text: string) => <span className="t muted"><span>{text}</span></span>;
  const line = <>
    <span className="n"><span className="sr-only">Game </span>{g.game.number}</span>
    <span className="teams">
      {o.matchups.length === 0 ? word('Not paired yet') : !mine ? word('Not playing') : <>
        {team(mine, mine.result === 'L')}
        {them ? team(them, mine.result === 'W') : word('Bye')}
      </>}
      {note && <small>{note}</small>}
    </span>
    <span className={pick > 0 ? 'state go' : 'state'}>
      {pick > 0 ? <span>Pick {pick}</span>
        : g.status === 'live' ? <span className="live"><span className="dot" aria-hidden="true" />Live</span>
          : <span>{statusWord(g)}</span>}
      {unofficial && <span>unofficial</span>}
    </span>
  </>;
  if (g.status === 'upcoming' || g.status === 'void') return <div className="game-line">{line}</div>; // nothing to open: no chevron
  return (
    <details>
      <summary className="game-line">{line}</summary>
      <GameDetail y={y} g={g} o={o} mine={mine ?? null} them={them ?? null} membershipId={membershipId} unofficial={unofficial} />
    </details>
  );
}

/**
 * An opened game (ruling 9): your matchup's two sides first, then "Other matchups", each a line that opens to its
 * sides. `o` carries the numbers (unofficial while the game isn't verified).
 */
function GameDetail({ y, g, o, mine, them, membershipId, unofficial }: {
  y: LeagueTournament; g: GameOutcome; o: GameOutcome; mine: TournamentSide | null; them: TournamentSide | null;
  membershipId: string; unofficial: boolean;
}) {
  const others = mine ? o.matchups.filter((m) => m.home !== mine && m.away !== mine) : o.matchups;
  const named = (s: TournamentSide) => `${y.team.get(s.membershipId) ?? 'A team'}${s.score === null ? '' : ` ${fmt(s.score)}`}`;
  // A bye side with nobody to start has no players, not a forfeit (Review Focus 2).
  const pair = (a: TournamentSide, b: TournamentSide | null) => <>
    <SideDetail y={y} g={g} side={a} membershipId={membershipId} empty={b ? 'Forfeit' : 'No players'} />
    {b ? <SideDetail y={y} g={g} side={b} membershipId={membershipId} empty="Forfeit" /> : <p className="muted">Bye</p>}
  </>;
  return (
    <div className="stack">
      {mine && pair(mine, them)}
      {others.length > 0 && (
        <div className="game-group">
          <h3>Other matchups</h3>
          {others.map((m) => (
            <details key={m.home.membershipId}>
              <summary><span>{named(m.home)} · {m.away ? named(m.away) : 'Bye'}</span></summary>
              <div className="stack">{pair(m.home, m.away)}</div>
            </details>
          ))}
        </div>
      )}
      {unofficial && <p className="hint">Unofficial until a keeper verifies.</p>}
    </div>
  );
}

/**
 * "2 goals, 1 assist" (ruling 3). None: "no stats yet" until the game is verified, then "didn't play", or "no stats"
 * when the verified stat line is all zeros (they played).
 */
function statsOf(y: LeagueTournament, g: GameOutcome, a: string) {
  const line = y.input.statLines.find((l) => l.sessionId === g.game.sessionId && l.athleteId === a);
  return statWords(line?.stats ?? {}) || (g.status !== 'final' && !g.heldBy ? 'no stats yet' : line ? 'no stats' : "didn't play");
}

/**
 * The matchup's starters for one team: its name and score, then each starter's line (ruling 10) "Finn · 1 goal ·
 * 6 × 12.5%" and points, then `children`. A starter who scored 0 has nothing to multiply: the line ends at the stats.
 */
function StarterSide({ y, g, side, name, since, children }: {
  y: LeagueTournament; g: GameOutcome; side: TournamentSide; name: string; since?: Record<string, number>; children?: ReactNode;
}) {
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
              <small>{athleteName(y, a)} · {statsOf(y, g, a)}{side.athleteScores?.[a] ? ` · ${fmt(side.athleteScores[a])} × ${pctExact(side.factor[a])}` : ''}</small>
              {side.points && <strong className="num">{since?.[a] != null && <span className={since[a] > 0 ? 'since up' : 'since down'}>{signed(since[a])}<span className="sr-only"> since you last looked, now </span></span>}{fmt(side.points[a])}</strong>}
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}

/**
 * One team's side of an opened game: its score, who the app started for it, then each starter "name · stats" and
 * "base × exact % = points" (ruling 10). A starter with a base of 0 has nothing to multiply: just the 0.
 */
function SideDetail({ y, g, side, membershipId, empty }: {
  y: LeagueTournament; g: GameOutcome; side: TournamentSide; membershipId: string;
  /** What a side with no starters reads. */
  empty: string;
}) {
  const name = y.team.get(side.membershipId) ?? 'A team';
  return (
    <div className="stack">
      <p className="head">
        <span className="by">{name}</span>
        {side.score !== null && <span className="num">{fmt(side.score)}</span>}
      </p>
      <Notice y={y} side={side} played team={side.membershipId === membershipId ? undefined : name} />
      {side.athleteIds.length === 0 ? <p className="muted">{empty}</p> : (
        <ul className="list">
          {side.athleteIds.map((a) => (
            <li key={a}>
              <small>{athleteName(y, a)} · {statsOf(y, g, a)}</small>
              {side.points && (
                <strong className="num calc">
                  {side.athleteScores?.[a] ? `${fmt(side.athleteScores[a])} × ${pctExact(side.factor[a])} = ` : ''}{fmt(side.points[a])}
                </strong>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
