import { useId } from 'react';
import type { TournamentSide } from '../../core/tournament';

/** Colour steps for a points multiplier: green from ×0.5, blue from ×0.25, amber from ×0.1, red under that. */
export const factorTier = (x: number) => (x >= 0.5 ? 'high' : x >= 0.25 ? 'mid' : x >= 0.1 ? 'low' : 'min');

/** A multiplier as a decimal: 2 places ("0.30", "1.00"), or 2 significant figures under 0.1 so a small one still reads ("0.068"). */
export const dec = (x: number) => (x >= 0.1 ? x.toFixed(2) : String(Number(x.toPrecision(2))));

/**
 * A player's points multiplier for one game (the core's `factor`), as one number in a bubble: "×0.27". Tapping it opens
 * the parts in a native popover (as the "?" helps do): "Tired 0.25 × earlier tournaments 0.90 × owned 0.30 = 0.068".
 */
export function Factor({ side, athleteId }: { side: Pick<TournamentSide, 'share' | 'rest' | 'decay' | 'factor'>; athleteId: string }) {
  const id = useId();
  const value = side.factor[athleteId];
  return (
    <>
      <button type="button" className={`factor ${factorTier(value)}`} popoverTarget={id} aria-label={`Points ×${dec(value)}: show the parts`}>
        ×{dec(value)}
      </button>
      {/* A span, so it is valid inside a p or a small. */}
      <span id={id} popover="auto" className="help-pop" role="note">
        {`Tired ${dec(side.rest[athleteId])} × earlier tournaments ${dec(side.decay[athleteId])} × owned ${dec(side.share[athleteId])} = ${dec(value)}`}
      </span>
    </>
  );
}
