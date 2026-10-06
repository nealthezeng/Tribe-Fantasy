import { useLayoutEffect, useRef } from 'react';

/** Moves a nav's `.ink` marker under its current item (aria-current or aria-pressed); CSS animates the glide.
 *  Re-measures when `active` changes, on resize, and once web fonts have loaded (they change tab widths). */
export function useInk<T extends HTMLElement>(active: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const place = () => {
      if (!nav.offsetWidth) return; // hidden (the phone dock on the tally board): keep the last spot, it measures as 0
      const on = nav.querySelector<HTMLElement>('[aria-current="page"], [aria-pressed="true"]');
      if (on) nav.style.setProperty('--ink-x', `${on.offsetLeft}px`); // none current (Me, Admin): shrink in place
      nav.style.setProperty('--ink-w', `${on?.offsetWidth ?? 0}px`);
    };
    place();
    // Glide only after the first placement, so the marker doesn't sweep in from the left on page load.
    const ready = requestAnimationFrame(() => nav.querySelector('.ink')?.classList.add('ready'));
    void document.fonts?.ready.then(place);
    window.addEventListener('resize', place);
    return () => { cancelAnimationFrame(ready); window.removeEventListener('resize', place); };
  }, [active]);
  return ref;
}
