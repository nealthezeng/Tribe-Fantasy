import { useId, type ReactNode } from 'react';
import type { SeasonSettings } from '../../core/settings';

/** Rounded as the Rules page does. */
export const n = (x: number) => +x.toFixed(2);

/** A "?" button (a 44 px target) that opens its text in a native popover: the browser centres it, Esc and tap-outside close it. */
export function Help({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <>
      <button type="button" className="help" popoverTarget={id} aria-label={label}><span aria-hidden="true">?</span></button>
      {/* A span, so it is valid inside a p. */}
      <span id={id} popover="auto" className="help-pop" role="note">{children}</span>
    </>
  );
}

export function SharesHelp({ settings: S }: { settings: SeasonSettings }) {
  return (
    <Help label="How buying shares works">
      Put credits on players to buy shares in them. A player has {S.min_shares} shares, or one per credit if the league puts more on them.
      You own your credits' worth and score that part of their points. Every team gets free credits before each tournament,
      and unspent ones carry over. A × by a name means you started them in an earlier tournament, so their points count less for you.
    </Help>
  );
}

export function FactorHelp({ settings: S }: { settings: SeasonSettings }) {
  const tired = S.tiredness_multipliers.length
    ? S.tiredness_multipliers.map((m, i) => `×${n(m)} if ${i ? `${i + 1} games` : 'they started the game'} before`).join(', ')
    : 'never';
  return (
    <Help label="What the × means">
      The × by a player is what their points count for you this game: your share × tired × earlier tournaments. Tired: {tired}.
      Earlier tournaments: a little less for each one you started them in, never below ×{n(S.decay_floor)}. Tap a × to see its parts.
    </Help>
  );
}

export function VerifiedHelp({ hours }: { hours: number }) {
  return (
    <Help label="What unofficial and verified mean">
      Keepers tap stats during the game, then a keeper checks and verifies them. Until then scores are unofficial and can change.
      Verified stats count; they can be reopened for {hours} {hours === 1 ? 'hour' : 'hours'}, then they're locked.
    </Help>
  );
}
