/**
 * Registers the app-shell worker and keeps it fresh. An installed app is resumed, not reloaded, so coming back to the
 * front checks for a new worker. Once a new one has taken over, the next return asks whether the running bundle
 * (ownUrl) is still cached: if not, this page is an old build and reloads then, never while in use. The check waits for
 * that return because the controller changes before the new worker's activate step has deleted the old shell.
 */
export async function registerServiceWorker(
  sw: ServiceWorkerContainer,
  ownUrl: string,
  reload: () => void = () => location.reload(),
): Promise<void> {
  const reg = await sw.register(`${import.meta.env.BASE_URL}sw.js`);
  let changed = false;
  sw.addEventListener('controllerchange', () => (changed = true));
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return;
    if (changed && !(await caches.match(ownUrl))) reload();
    else reg.update().catch(() => {}); // offline: stay quiet
  });
}

/** Production only: dev, the sim and tests never register. A failed register is ignored, the site works without it. */
export function startPwa(): void {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    registerServiceWorker(navigator.serviceWorker, import.meta.url).catch(() => {});
  }
}
