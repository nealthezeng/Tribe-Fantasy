import { useSyncExternalStore } from 'react';

/**
 * Registers the app-shell worker and keeps it fresh. An installed app is resumed, not reloaded, so coming back to the
 * front checks for a new worker. Once a new one has taken over, the next return asks whether this page's own files
 * (ownUrls: the running bundle and its stylesheets, so a CSS-only deploy counts too) are all still cached: if any is
 * missing, this page is an old build and reloads then, never while in use. The check waits for that return because the
 * controller changes before the new worker's activate step has deleted the old shell.
 */
export async function registerServiceWorker(
  sw: ServiceWorkerContainer,
  ownUrls: string[],
  reload: () => void = () => location.reload(),
): Promise<void> {
  const reg = await sw.register(`${import.meta.env.BASE_URL}sw.js`);
  let changed = false;
  sw.addEventListener('controllerchange', () => (changed = true));
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    // ignoreVary as in sw.js; a failed lookup counts as found: no reload
    const found = () =>
      Promise.all(ownUrls.map((u) => caches.match(u, { ignoreVary: true }).then(Boolean, () => true)));
    if (changed && (await found()).includes(false)) reload();
    else reg.update().catch(() => {}); // offline: stay quiet
  });
}

/** The browser's install offer (Chrome, Edge, Android), kept for the account menu's Install app. Single use. */
type InstallPrompt = Event & { prompt: () => Promise<unknown> };
let kept: InstallPrompt | null = null;
const watchers = new Set<() => void>();
function keep(e: InstallPrompt | null) {
  kept = e;
  watchers.forEach((w) => w());
}
function watch(w: () => void) {
  watchers.add(w);
  return () => watchers.delete(w);
}

/**
 * Keeps the install offer for the menu. The worker is production only: dev, the sim and tests never register. This
 * never throws (reading navigator.serviceWorker can, in an opaque-origin page): the site works without the worker.
 */
export function startPwa(): void {
  try {
    addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      keep(e as InstallPrompt);
    });
    addEventListener('appinstalled', () => keep(null));
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      // This page's own files: the entry bundle and this site's stylesheets (not Google Fonts, never cached).
      const css = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
        .map((l) => l.href).filter((h) => h.startsWith(`${location.origin}/`));
      registerServiceWorker(navigator.serviceWorker, [import.meta.url, ...css]).catch(() => {});
    }
  } catch {
    // navigator.serviceWorker threw: no worker, the site still works
  }
}

/** Running as the installed app (Android, desktop; navigator.standalone is iOS's own flag). */
export function isStandalone(): boolean {
  return Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone or iPad; an iPad asks for the desktop site, so it reads as a Mac with a touch screen. */
export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/** Whether the browser has offered to install. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(watch, () => kept !== null);
}

/** Shows the browser's install dialog, once: the offer is dropped whatever the answer. */
export function promptInstall(): void {
  const e = kept;
  keep(null);
  e?.prompt().catch(() => {});
}
