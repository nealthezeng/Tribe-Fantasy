import { matchupDeltas, stageAllowance, TIE_EPSILON } from '../../core/points';
import { athleteWeekScore } from '../../core/scoring';
import { DEFAULT_SETTINGS as S } from '../../core/settings';
import { stageMultiplier } from '../../core/decay';
import { statLabel } from '../lib/stats';

const LOCK_DAY: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const n = (x: number) => +x.toFixed(2);
const signed = (x: number) => (x > 0 ? `+${n(x)}` : `${n(x)}`);

/** 9:00 PM from '21:00'. */
function clock(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// The worked example: one practice and one tournament for the same player in one week.
const practice = { goal: 1, assist: 2, turnover: 1 };
const tournament = { goal: 2, block: 1, turnover: 2 };
const weekScore = athleteWeekScore([
  { athleteId: 'x', sessionType: 'practice', pointsPlayed: 0, stats: practice },
  { athleteId: 'x', sessionType: 'tournament', pointsPlayed: 0, stats: tournament },
], S);
const raw = (stats: Record<string, number>) => Object.entries(stats).reduce((t, [k, c]) => t + (S.stat_weights[k] ?? 0) * c, 0);
const line = (stats: Record<string, number>) => Object.entries(stats).map(([k, c]) => `${c} ${statLabel(k)}`).join(', ');

// Points examples in a 6-team league: an even game, an upset and a favourite winning.
const size = S.max_members;
const ranks = { first: 1, third: 3, fourth: 4, last: size };
const win = (winner: keyof typeof ranks, loser: keyof typeof ranks) =>
  matchupDeltas({ managerId: winner, score: 10 }, { managerId: loser, score: 5 }, ranks, size, S);
const even = win('third', 'fourth');
const upset = win('last', 'first');
const favourite = win('first', 'last');

const allowance = (rank: number) => stageAllowance(rank, size, S);

export function RulesPage() {
  return (
    <section className="page">
      <h1>How Tribe Fantasy works</h1>
      <p className="notice">
        Tribe Fantasy is a fantasy league for our team. Playing is free. Donations go to the team fund, and they're
        turned off during the fall beta. The commissioner can change any number below for a season; these are the
        standard settings.
      </p>

      <article className="card">
        <h2>The year</h2>
        <ul>
          <li>The league runs all year. The year is split into <strong>seasons</strong> of two or three weeks, each
            ending at a tournament.</li>
          <li>Each league has up to {S.max_members} teams. Every team plays one head-to-head matchup a week, all
            year. Standings never reset between seasons.</li>
          <li>Rosters are rebuilt every season in a fresh auction. Each roster holds {S.roster_size} players. There are
            no trades.</li>
          <li>The team at the top of the year's standings wins a merch prize. There is no cash prize.</li>
        </ul>
      </article>

      <article className="card">
        <h2>Credits and the auction</h2>
        <ul>
          <li>Every team gets free credits at the start of each season: {allowance(1)} for the team in first, up to{' '}
            {allowance(size)} for the team in last. Unspent credits carry over.</li>
          <li>Bids are sealed: nobody sees anyone's bids until the auction closes. Then every bid is shown to the
            league.</li>
          <li>The highest bid wins each player and pays what it bid. A tie goes to the bid placed first. The minimum
            bid is {S.min_bid} credit.</li>
          <li>Players nobody won are dealt at random to teams with open spots, for free. Injured players are never
            dealt. If there aren't enough players, a team plays that season short.</li>
          <li>You can't own yourself.</li>
        </ul>
      </article>

      <article className="card">
        <h2>Your weekly pick</h2>
        <ul>
          <li>Each week you start <strong>one</strong> player from your roster. You can't start the same player twice
            until you've used everyone on your roster that season.</li>
          <li>Picks lock {LOCK_DAY[S.pick_lock_day]} at {clock(S.pick_lock_time)} (Eastern). Other teams' picks stay
            hidden until then.</li>
          <li>Forgot to pick? We start your best unused player (by their scores so far) for you.</li>
          <li>If your pick is injured at the lock, we swap in your best unused healthy player, and you'll see a
            notice. A week where your player was injured and didn't play doesn't use them up.</li>
        </ul>
      </article>

      <article className="card">
        <h2>Scoring</h2>
        <p>Your score is your player's stats from that week's practices and tournaments. Tournament stats count
          ×{S.session_multipliers.tournament}.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Stat</th><th>Points</th></tr></thead>
            <tbody>
              {Object.entries(S.stat_weights).map(([k, w]) => (
                <tr key={k}><td>{statLabel(k)}</td><td>{signed(w)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="section">
          <h3>Example</h3>
          <p>Practice: {line(practice)} = {n(raw(practice))}.</p>
          <p>Tournament: {line(tournament)} = {n(raw(tournament))}, ×{S.session_multipliers.tournament} ={' '}
            {n(raw(tournament) * S.session_multipliers.tournament)}.</p>
          <p>Week score: <strong>{n(weekScore)}</strong>. The higher score wins the matchup.</p>
        </div>
        <p className="muted">A session's stats count once a stat keeper has verified them and {S.stat_lock_hours} hours
          have passed with no corrections.</p>
      </article>

      <article className="card">
        <h2>Standings points</h2>
        <p>Winning earns points and losing costs points. Beating a team above you in the standings pays more, and
          losing to one costs less.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>In a {size}-team league</th><th>Winner</th><th>Loser</th></tr></thead>
            <tbody>
              <tr><td>3rd beats 4th</td><td>{signed(even.third)}</td><td>{signed(even.fourth)}</td></tr>
              <tr><td>Last beats 1st</td><td>{signed(upset.last)}</td><td>{signed(upset.first)}</td></tr>
              <tr><td>1st beats last</td><td>{signed(favourite.first)}</td><td>{signed(favourite.last)}</td></tr>
            </tbody>
          </table>
        </div>
        <p>A tie (scores within {TIE_EPSILON}) gives both teams {signed(S.tie_points)}.</p>
      </article>

      <article className="card">
        <h2>Starting the same player every season</h2>
        <p>Stats from a player you've started in earlier seasons count a little less, so rosters keep changing.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Earlier seasons you started them</th><th>Their stats count</th></tr></thead>
            <tbody>
              {[0, 1, 2, 3, 4, 6].map((k) => (
                <tr key={k}><td>{k}</td><td>×{n(stageMultiplier(k, S))}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">It never drops below ×{S.decay_floor}.</p>
      </article>

      <article className="card">
        <h2>Questions</h2>
        <div className="stack">
          <h3>Do I have to pay?</h3>
          <p>No. Everyone plays on free credits.</p>
          <h3>Where does a donation go?</h3>
          <p>A donation is a donation to the team fund. It buys credits at {S.credits_per_dollar} credits per
            dollar. Credits have no cash value and can't be refunded or cashed out. Donations are off during the
            fall beta.</p>
          <h3>Who can see what?</h3>
          <p>Your league sees rosters, results and every bid after the auction closes. Only you and the league staff
            see your credit balance. Other teams can't see your pick until it locks.</p>
          <h3>I'm a player. Can I opt out?</h3>
          <p>Yes. Tell a captain. Players who opt out are never listed, bid on or scored.</p>
          <h3>What if a stat is wrong?</h3>
          <p>Tell a stat keeper. Sessions can be reopened before they lock, and an admin can correct a locked
            session. Scores update by themselves.</p>
        </div>
      </article>
    </section>
  );
}
