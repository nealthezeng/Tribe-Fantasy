import { useState } from 'react';
import { Link } from 'react-router';
import { DEFAULT_SETTINGS } from '../../core/settings';
import { loadCurrentSeason } from '../lib/stats';
import { useLoad } from '../lib/useLoad';

/** The four steps of the game; the Rules page opens with the same ones (t320). */
export function GuideSteps({ picks }: { picks: number }) {
  return (
    <ol className="guide-steps">
      <li><strong>Get a team.</strong> Join or create a league. Your team plays in it all season.</li>
      <li><strong>Buy shares.</strong> Before each tournament, put your free credits on teammates. You score the part of each player you own.</li>
      <li><strong>Pick {picks} each game.</strong> Before every game, choose {picks} of your players to start.</li>
      <li><strong>Higher score wins.</strong> Your starters&apos; stats add up to your score. Win to climb the standings.</li>
    </ol>
  );
}

const key = (uid: string) => `tribe.guide.${uid}`;
const seen = (uid: string) => { try { return localStorage.getItem(key(uid)) === '1'; } catch { return false; } };

/** Shown on League until "Got it", once per account and device; a blocked storage shows it again next visit. Got it
 *  moves focus to the page's h1, which needs tabIndex -1. */
export function Guide({ uid }: { uid: string }) {
  const [hidden, setHidden] = useState(() => seen(uid));
  const season = useLoad(() => loadCurrentSeason().catch(() => null), []); // no season: the default count
  if (hidden) return null;
  const done = () => {
    document.querySelector<HTMLElement>('h1')?.focus(); // the button is going: focus stays on the page, not <body>
    setHidden(true);
    try { localStorage.setItem(key(uid), '1'); } catch { /* hidden for this visit only */ }
  };
  return (
    <aside className="notice guide" aria-label="How it works">
      <h2>How it works</h2>
      <GuideSteps picks={season.data?.settings.picks_per_game ?? DEFAULT_SETTINGS.picks_per_game} />
      <div className="row">
        <button type="button" onClick={done}>Got it</button>
        <Link to="/rules" className="more">All the rules</Link>
      </div>
    </aside>
  );
}
