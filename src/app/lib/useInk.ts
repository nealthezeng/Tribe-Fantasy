import { useLayoutEffect, useRef } from 'react';

/** Moves a nav's `.ink` marker under its current item (aria-current or aria-pressed); CSS animates the glide.
 *  Sets --ink-x / --ink-w, plus --ink-y / --ink-h for the admin pill, whose chips can wrap onto a second row.
 *  Re-measures when `active` changes, on resize, and once web fonts have loaded (they change tab widths). */
export function useInk<T extends HTMLElement>(active: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const place = () => {
      if (!nav.offsetWidth) return; // hidden (the phone dock on the tally board): keep the last spot, it measures as 0
      const on = nav.querySelector<HTMLElement>('[aria-current="page"], [aria-pressed="true"]');
      if (on) { // none current (Me, Admin): shrink in place
        nav.style.setProperty('--ink-x', `${on.offsetLeft}px`);
        nav.style.setProperty('--ink-y', `${on.offsetTop}px`); // the row, once admin chips wrap
        nav.style.setProperty('--ink-h', `${on.offsetHeight}px`);
      }
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
