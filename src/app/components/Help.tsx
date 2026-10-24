import { useId, type ReactNode } from 'react';
import { stageMultiplier } from '../../core/decay';
import type { SeasonSettings } from '../../core/settings';
import { pct } from '../lib/wallet';
import { fraction } from '../lib/words';

/** Rounded as the Rules page does. */
export const n = (x: number) => +x.toFixed(2);
/** "+1", "0", "-1.5", as the Rules page does. */
export const signed = (x: number) => (x > 0 ? `+${n(x)}` : `${n(x)}`);

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

// tiredness_multipliers holds at most 10 steps (settings.ts).
const GAMES_BEFORE = ['the game', 'two games', 'three games', 'four games', 'five games', 'six games', 'seven games',
  'eight games', 'nine games', 'ten games'];

/** Beside the pick card and a team's players: share, tired steps and earlier tournaments, in words (rulings 3–4). */
export function FactorHelp({ settings: S }: { settings: SeasonSettings }) {
  const tired = S.tiredness_multipliers
    .map((m, i) => (i ? `${GAMES_BEFORE[i]} before, ${fraction(m)}` : `If he was picked for the game before, they count ${fraction(m)}`))
    .join('; ');
  // The cut starts after the free (grace) tournaments; no cut at all (no decay, a rate of 1) needs no sentence.
  const g = S.decay_grace_stages;
  const free = g === 0 ? 'Each earlier tournament he was picked in'
    : g === 1 ? 'The first earlier tournament he was picked in is free; each one after'
    : `The first ${g} earlier tournaments he was picked in are free; each one after`;
  const decay = stageMultiplier(g + 1, S) < 1 && `${free} lowers them a little more `
    + `(${pct(stageMultiplier(g + 1, S))}, then ${pct(stageMultiplier(g + 2, S))}, …), never below ${pct(S.decay_floor)}.`;
  return (
    <Help label="How a player's points count">
      {["You score your share of a player's points.", tired && `${tired}.`, decay].filter(Boolean).join(' ')}
    </Help>
  );
}

/**
 * Beside a standings table (X7): the points a result gives (matchupDeltas), then the order (rankSnapshot): points, then
 * total score, equal on both = a shared place. With no upset factor a win and a loss are exact, so no "about".
 */
export function StandingsHelp({ settings: S }: { settings: SeasonSettings }) {
  const weighted = S.points_mode === 'rank_weighted' && S.upset_k > 0;
  const about = weighted ? 'about ' : '';
  return (
    <Help label="How the table is ordered">
      {`A win adds ${about}${n(S.win_points)} standings point${S.win_points === 1 ? '' : 's'} and a loss takes away `
        + `${about}${n(S.loss_points)}${weighted ? ': beating a team above you adds more, losing to one takes away less' : ''}. `
        + `A tie gives each team ${signed(S.tie_points)}. Level on points, the team that scored more over all its games goes `
        + 'first; level on both, they share the place (T2).'}
    </Help>
  );
}

export function VerifiedHelp({ hours }: { hours: number }) {
  return (
    <Help label="What unofficial and verified mean">
      Keepers tap stats live, so scores move during the game. After it, a second keeper checks them: then they're final.
      {hours > 0 && ` A final game can be reopened for ${hours} ${hours === 1 ? 'hour' : 'hours'}.`}
    </Help>
  );
}
