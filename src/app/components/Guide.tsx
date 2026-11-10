/** The four steps of the game, at the top of the Rules page. */
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
