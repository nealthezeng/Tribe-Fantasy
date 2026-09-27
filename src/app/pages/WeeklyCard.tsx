import { useState } from 'react';
import { rawScore } from '../../core/scoring';
import type { WeekOutcome, YearSide } from '../../core/year';
import { formatWhen } from '../lib/auction';
import { errorMessage } from '../lib/errors';
import { api } from '../lib/rpc';
import { formatDay, kindLabel, statLabel } from '../lib/stats';
import { useLoad } from '../lib/useLoad';
import { loadLeagueYear, type LeagueYear } from '../lib/weekly';

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${fmt(Math.abs(n))}`;

/** Weekly play for one team: this week's pick, standings, and every week so far. */
export function WeeklyCard({ membershipId, leagueId, seasonId }: { membershipId: string; leagueId: string; seasonId: string }) {
  const { data, error, reload } = useLoad(() => loadLeagueYear(seasonId, leagueId), [seasonId, leagueId]);
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data || data.result.weeks.length === 0) return null; // loading, or no weeks yet
  const { weeks } = data.result;
  const sideOf = (w: WeekOutcome) => w.matchups.flatMap((m) => [m.home, m.away]).find((x) => x?.membershipId === membershipId) ?? null;
  const opponentOf = (w: WeekOutcome) => {
    const m = w.matchups.find((x) => x.home.membershipId === membershipId || x.away?.membershipId === membershipId);
    if (!m || m.away === null) return null;
    return m.home.membershipId === membershipId ? m.away : m.home;
  };
  const live = weeks.find((w) => w.status === 'locked');
  const next = weeks.find((w) => w.status === 'open');

  return (
    <article className="card" aria-label="Weekly matchups">
      <h2>Weekly matchups</h2>
      {live && <LiveWeek y={data} w={live} mine={sideOf(live)} them={opponentOf(live)} />}
      {next && (
        <PickWeek key={next.week.id} y={data} w={next} mine={sideOf(next)} them={opponentOf(next)}
          membershipId={membershipId} onSaved={reload} />
      )}
      <Standings y={data} membershipId={membershipId} />
      <div className="section">
        <h3>Weeks</h3>
        {[...weeks].reverse().filter((w) => w.status !== 'open' && w.status !== 'locked').map((w) => (
          <WeekRow key={w.week.id} y={data} w={w} membershipId={membershipId} />
        ))}
        {weeks.every((w) => w.status === 'open' || w.status === 'locked') && <p className="muted">No weeks played yet.</p>}
      </div>
    </article>
  );
}

const weekTitle = (y: LeagueYear, w: WeekOutcome) =>
  `Week ${w.index + 1} · ${formatDay(w.week.startsOn)} – ${formatDay(w.week.endsOn)} · ${y.stage.get(w.week.stageId) ?? ''}`;

function PickWeek({ y, w, mine, them, membershipId, onSaved }: {
  y: LeagueYear; w: WeekOutcome; mine: YearSide | null; them: YearSide | null; membershipId: string; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = (id: string | null) => (id ? y.athlete.get(id) ?? 'A player' : 'nobody');
  if (!mine) return <p className="muted">You joined after this week's picks were set. You'll play from next week.</p>;
  const rostered = mine.roster.length > 0;
  const available = new Set(mine.available);
  const roster = [...mine.roster].sort((a, b) =>
    Number(!available.has(a)) - Number(!available.has(b)) || name(a).localeCompare(name(b)));

  async function choose(athleteId: string | null) {
    setBusy(true);
    setError(null);
    try {
      await api.setPick(membershipId, w.week.id, athleteId);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(false);
  }

  return (
    <div className="stack">
      <div className="head">
        <h3>{weekTitle(y, w)}</h3>
        <span className="pill info">Picks lock {formatWhen(w.week.pickLockAt)}</span>
      </div>
      <p>{them ? <>You play <strong>{y.team.get(them.membershipId)}</strong>.</> : 'You have a bye this week.'}</p>
      {!rostered && <p className="muted">Your roster for this season isn't set yet. Picks open once the auction runs.</p>}
      {mine.notice === 'injured' && (
        <p className="notice">{name(mine.picked)} is injured. At the lock we'll swap in {name(mine.athleteId)} unless you change your pick.</p>
      )}
      {mine.notice === 'missed' && rostered && (
        <p className="notice">No pick yet. If you don't pick, {name(mine.athleteId)} plays{mine.athleteId ? '' : ' and you forfeit'}.</p>
      )}
      {mine.notice === 'used' && (
        <p className="notice">{name(mine.picked)} can't play again this cycle, so {name(mine.athleteId)} will play unless you change your pick.</p>
      )}
      {rostered && (
        <ul className="list">
          {roster.map((id) => {
            const used = !available.has(id);
            const injured = y.injured.has(id);
            const chosen = mine.picked === id;
            return (
              <li key={id}>
                <span className="meta">
                  <span className="title">{name(id)}</span>
                  {used && <span className="pill">Used</span>}
                  {injured && <span className="pill bad">Injured</span>}
                </span>
                {chosen ? (
                  <button className="secondary" aria-pressed="true" disabled={busy} onClick={() => void choose(null)}>
                    Your pick ✓ <span className="muted">· Clear</span>
                  </button>
                ) : (
                  <button disabled={busy || used} onClick={() => void choose(id)}>Pick</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted"><small>Each player plays once per cycle; once your whole roster has played, the cycle starts over.</small></p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}

function LiveWeek({ y, w, mine, them }: { y: LeagueYear; w: WeekOutcome; mine: YearSide | null; them: YearSide | null }) {
  if (!mine) return null;
  const name = (id: string | null) => (id ? y.athlete.get(id) ?? 'A player' : 'nobody (forfeit)');
  return (
    <div className="stack">
      <div className="head">
        <h3>{weekTitle(y, w)}</h3>
        <span className="pill ok">Playing now</span>
      </div>
      <p>
        {name(mine.athleteId)}
        {them ? <> vs <strong>{y.team.get(them.membershipId)}</strong>: {name(them.athleteId)}</> : ' · bye'}
      </p>
      <Notice y={y} side={mine} />
      <p className="muted">Scores appear once this week's stats lock.</p>
    </div>
  );
}

function Notice({ y, side }: { y: LeagueYear; side: YearSide }) {
  const name = (id: string | null) => (id ? y.athlete.get(id) ?? 'A player' : 'nobody');
  if (!side.notice) return null;
  const who = side.athleteId ? `${name(side.athleteId)} was picked for you` : 'nobody was left to play (forfeit)';
  const why = { missed: "You didn't pick", injured: `${name(side.picked)} was injured`, used: `${name(side.picked)} had already played this cycle` }[side.notice];
  return <p className="notice">{why}, so {who}.</p>;
}

function Standings({ y, membershipId }: { y: LeagueYear; membershipId: string }) {
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

const STATUS: Record<WeekOutcome['status'], [string, string]> = {
  open: ['Picking', 'pill info'],
  locked: ['Playing', 'pill ok'],
  pending: ['Waiting on stats', 'pill warn'],
  final: ['Final', 'pill'],
  skipped: ['No games', 'pill'],
};

function WeekRow({ y, w, membershipId }: { y: LeagueYear; w: WeekOutcome; membershipId: string }) {
  const mine = w.matchups.flatMap((m) => [m.home, m.away]).find((x) => x?.membershipId === membershipId);
  const [label, cls] = STATUS[w.status];
  return (
    <details className="section">
      <summary>
        <span className="meta">
          {weekTitle(y, w)}
          <span className={cls}>{label}</span>
          {mine?.delta != null && <strong className="num">{mine.result} {signed(mine.delta)}</strong>}
        </span>
      </summary>
      {w.status === 'skipped' && <p className="muted">No counted sessions this week, so nobody played and nobody was used up.</p>}
      {w.status === 'pending' && <p className="muted">Scores appear once every counted session this week (and earlier weeks) has locked.</p>}
      {w.status !== 'skipped' && w.matchups.map((m) => (
        <div key={m.home.membershipId} className="stack">
          <SideDetail y={y} w={w} side={m.home} />
          {m.away ? <SideDetail y={y} w={w} side={m.away} /> : <p className="muted">Bye</p>}
        </div>
      ))}
    </details>
  );
}

function SideDetail({ y, w, side }: { y: LeagueYear; w: WeekOutcome; side: YearSide }) {
  const sessions = y.sessions.filter((s) => s.counts && s.heldOn >= w.week.startsOn && s.heldOn <= w.week.endsOn);
  const lines = side.athleteId === null ? [] : sessions.flatMap((s) => {
    const l = y.statLines.find((x) => x.sessionId === s.id && x.athleteId === side.athleteId);
    return l ? [{ s, l }] : [];
  });
  const mult = (kind: 'practice' | 'tournament') => y.settings.session_multipliers[kind] ?? 1;
  return (
    <div className="stack">
      <p className="head">
        <span><strong>{y.team.get(side.membershipId)}</strong> · {side.athleteId ? y.athlete.get(side.athleteId) : 'forfeit'}</span>
        {side.score !== null && <span className="num">{fmt(side.score)} {side.delta !== null && <>({signed(side.delta)})</>}</span>}
      </p>
      <Notice y={y} side={side} />
      {side.score !== null && side.athleteId !== null && (
        <ul className="list">
          {lines.length === 0 && <li className="muted">Didn't play a counted session: {fmt(y.settings.absent_score)}.</li>}
          {lines.map(({ s, l }) => (
            <li key={s.id}>
              <span>
                {formatDay(s.heldOn)} · {kindLabel(s.kind)}{mult(s.kind) !== 1 && <> <span className="pill">×{mult(s.kind)}</span></>}<br />
                <small>{Object.entries(l.stats).filter(([, n]) => n).map(([k, n]) => `${n} ${statLabel(k)}`).join(', ') || 'No stats'}</small>
              </span>
              <span className="num">{fmt(mult(s.kind) * rawScore(l.stats, y.settings.stat_weights))}</span>
            </li>
          ))}
          <li>
            <span>Week score × {fmt(side.multiplier!)} (repeat-start multiplier)</span>
            <strong className="num">{fmt(side.athleteScore!)} × {fmt(side.multiplier!)} = {fmt(side.score)}</strong>
          </li>
        </ul>
      )}
    </div>
  );
}
