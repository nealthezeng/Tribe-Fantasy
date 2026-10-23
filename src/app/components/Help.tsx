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
  const m = S.min_shares;
  // The worked example only holds at the default 200 shares.
  const example = m === 200 ? '40 credits buys 40 of them, so you own 20% and score 20% of his points' : 'a credit buys a share';
  return (
    <Help label="How buying shares works">
      {`Your credits buy a slice of a player. Each player is ${m} shares: ${example}. If teams put more than ${m} credits `
        + 'on one player, every slice shrinks to fit. Free credits arrive before each tournament; unspent ones carry over.'}
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
