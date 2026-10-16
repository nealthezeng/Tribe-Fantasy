import { matchupDeltas, stageAllowance, TIE_EPSILON } from '../../core/points';
import { athleteWeekScore } from '../../core/scoring';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { stageMultiplier } from '../../core/decay';
import { loadCurrentSeason, statLabel } from '../lib/stats';
import { useLoad } from '../lib/useLoad';

const n = (x: number) => +x.toFixed(2);
const signed = (x: number) => (x > 0 ? `+${n(x)}` : `${n(x)}`);
const line = (stats: Record<string, number>) => Object.entries(stats).map(([k, c]) => `${c} ${statLabel(k)}`).join(', ');

// The worked example: one player's stats in one game, and how much of him you own.
const game = { goal: 2 };
const owned = 0.5;

export function RulesPage() {
  // Signed in: this season's numbers. Signed out (seasons aren't readable) or still loading: the defaults.
  const season = useLoad(loadCurrentSeason, []).data;
  const S = season?.settings ?? DEFAULT_SETTINGS;

  // Every scored game is a tournament game, so the tournament multiplier is folded into each stat's points.
  const mult = S.session_multipliers.tournament ?? 1;
  const gameScore = athleteWeekScore([{ athleteId: 'x', sessionType: 'tournament', pointsPlayed: 0, stats: game }], S);
  const tired = S.tiredness_multipliers[0] ?? 1;
  const pool = Math.max(S.min_shares, 150); // the split example: 100 and 50 credits on one player
  const pct = (credits: number) => Math.round((100 * credits) / pool);

  // Points examples in a full league: an even game, an upset and a favourite winning.
  const size = S.max_members;
  const ranks = { first: 1, third: 3, fourth: 4, last: size };
  const win = (winner: keyof typeof ranks, loser: keyof typeof ranks) =>
    matchupDeltas({ managerId: winner, score: 10 }, { managerId: loser, score: 5 }, ranks, size, S);
  const even = win('third', 'fourth');
  const upset = win('last', 'first');
  const favourite = win('first', 'last');
  const allowance = (rank: number) => stageAllowance(rank, size, S);

  return (
    <section className="page">
      <h1>How Tribe Fantasy works</h1>
      <p className="notice">
        Tribe Fantasy is a fantasy league for our team. Playing is free. Donations go to the team fund
        {S.donations_enabled && S.venmo_handle ? '.' : ", and they aren't open yet."}{' '}
        {season
          ? `The numbers below are ${season.name}'s settings.`
          : 'The commissioner can change any number below for a season; sign in to see this season\'s.'}
      </p>

      <article className="card">
        <h2>The season</h2>
        <ul>
          <li>The league runs all season, and the season is split into <strong>tournaments</strong>, the events our
            team plays.</li>
          <li>Anyone can create a league, open to all or with a password, or join one from the list. You can create one
            league a season. You can leave a league from the League page until your team has donated, bought shares
            or been paired for a game. If yours is the last team to leave, the league is deleted.</li>
          <li>Up to {S.max_members} teams in a league. Every game our team plays at a tournament, every fantasy
            team plays one head-to-head matchup. Standings never reset between tournaments.</li>
          <li>Rosters are rebuilt for every tournament, by buying shares in players. Each roster holds up to{' '}
            {S.roster_size} players. There are no trades.</li>
          <li>The team at the top of the season's standings wins a merch prize. There is no cash prize.</li>
        </ul>
      </article>

      <article className="card">
        <h2>Credits and shares</h2>
        <ul>
          <li>Every team gets free credits before each tournament: {allowance(1)} for the team in first, up to{' '}
            {allowance(size)} for the team in last. Unspent credits carry over.</li>
          <li>You buy shares by putting credits on players. Each roster holds up to {S.roster_size} players, and the
            minimum is {S.min_bid} credit. Your buys together can't be more than your credits: the app won't take one that
            goes over.</li>
          <li>Buys are sealed: nobody sees anyone's buys until buying closes. Then every buy is shown to the league.</li>
          <li>Every credit you put in is spent. A player has {S.min_shares} shares, or one per credit if the league puts
            more than that on him. You own your credits' worth. Put 100 credits on Sam while another team puts 50, and he
            has {pool} shares: you own {pct(100)}%, they own {pct(50)}%.</li>
          <li>Nobody loses a player, and nobody is dealt one. A team that buys into fewer than {S.roster_size} players
            plays the tournament with fewer.</li>
          <li>You can't own yourself.</li>
        </ul>
      </article>

      <article className="card">
        <h2>Your game picks</h2>
        <ul>
          <li>Each game you start {S.picks_per_game} of your players against one other fantasy team. Another team may
            start the same player; each side scores its own share.</li>
          <li>Opponents are paired Swiss style: teams close in the standings meet, and you don't play the same team
            twice if it can be avoided. Game 1 is paired by the standings when the
            tournament opens; each later game is paired when the game before it finishes.</li>
          <li>Pick for the next game any time before it starts, even before you know your opponent. Picks lock when a
            stat keeper starts the game. Other teams' picks stay hidden until then.</li>
          <li>Forgot to pick, or a pick is injured? We start your most rested healthy players, then the ones scoring
            best lately, and you'll see a notice.</li>
        </ul>
        <div className="section">
          <h3>Tired players</h3>
          <p>Starting a player in back-to-back games tires them. Resting a player for {S.tiredness_multipliers.length}{' '}
            {S.tiredness_multipliers.length === 1 ? 'game' : 'games'} between starts never does.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>You last started them</th><th>Their stats count</th></tr></thead>
              <tbody>
                {S.tiredness_multipliers.map((m, i) => (
                  <tr key={i}><td>{i === 0 ? 'The game before' : `${i + 1} games before`}</td><td>×{n(m)}</td></tr>
                ))}
                <tr><td>Earlier, or not yet this tournament</td><td>×1</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </article>

      <article className="card">
        <h2>Scoring</h2>
        <p>A starter's game score comes from his stats in that one game. A player with no stats in the game scores{' '}
          {n(S.absent_score)}.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Stat</th><th>Points</th></tr></thead>
            <tbody>
              {Object.entries(S.stat_weights).map(([k, w]) => (
                <tr key={k}><td>{statLabel(k)}</td><td>{signed(w * mult)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="section">
          <h3>Example</h3>
          <p>A starter earns his game score × three factors: the <strong>share</strong> you own, <strong>tired</strong>{' '}
            (above) and <strong>earlier tournaments</strong> (below). A player's card shows the combined factor, and its parts are one
            tap away. Your side's score is its {S.picks_per_game} starters added up, and the higher score wins the
            matchup.</p>
          <p>{line(game)} by a player you own half of, started the game before: {n(gameScore)} × {owned * 100}% ×{' '}
            {n(tired)} = <strong>{n(gameScore * owned * tired)}</strong>.</p>
        </div>
        <p className="muted">A game counts as soon as a stat keeper verifies its stats. They can be reopened for {S.stat_lock_hours} hours after that.</p>
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
        <h2>Starting the same player every tournament</h2>
        <p>Stats from a player you've started in earlier tournaments count a little less, so rosters keep changing.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Earlier tournaments you started them</th><th>Their stats count</th></tr></thead>
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
            dollar. Credits have no cash value and can't be refunded or cashed out.{' '}
            {S.donations_enabled && S.venmo_handle
              ? <>To donate, Venmo @{S.venmo_handle} with your team's 4-letter code in the note (it's on the Credits
                page, in the account menu). Credits show up within about 10 minutes.</>
              : "Donations aren't open yet."}</p>
          <h3>Who can see what?</h3>
          <p>Your league sees rosters, results and every buy and split after buying closes. Only you and the league staff
            see your credit balance. Other teams can't see your picks until the game starts.
            {S.donations_enabled && S.venmo_handle && <> The Credits page lists each donor's name and season total;
              tick Show me as Anonymous to hide your name.</>}</p>
          <h3>I'm a player. Can I opt out?</h3>
          <p>Yes. Tell a captain before share buying opens. Players who opt out aren't listed or bought in the next round.</p>
          <h3>Will I get emails?</h3>
          <p>Yes: 24 hours and 2 hours before buying shares closes, and when it's time to pick your players for the
            next game. Turn them off on the Me page.</p>
          <h3>What if a stat is wrong?</h3>
          <p>Tell a stat keeper. A game's stats can be reopened for {S.stat_lock_hours} hours after they're verified, and an admin can correct them after
            that. Scores update by themselves.</p>
        </div>
      </article>
    </section>
  );
}
