/* global CACHE, FILES */
// App-shell worker (M15 P8). The build writes two constants above this file: CACHE (a name unique to this deploy)
// and FILES (this build's files, relative to the site). It keeps the page and those files so the app opens offline.
// Supabase never comes through here: anything cross-origin or not a GET goes straight to the network, and nothing is
// written to a cache after install. rollback: see docs/setup-supabase.md, M15 P8.

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // cache: 'reload' skips the HTTP cache (GitHub Pages keeps pages 10 min), so page and files come from one deploy.
      // One missing file fails the install and the old worker stays.
      .then((cache) => cache.addAll(['./', ...FILES].map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // Other apps on this origin share the caches: only older tribe-shell-* are ours.
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tribe-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    request.mode === 'navigate'
      ? fetch(request).catch(() => caches.match('./')) // online: always the newest page (magic links, ?code=)
      : caches.match(request).then((hit) => hit || fetch(request)),
  );
});
