import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

// Runs src/sw.js the way the build does: the two constants prepended, the worker globals passed in.
const template = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

class FakeRequest {
  constructor(
    public url: string,
    public init?: RequestInit,
  ) {}
}

type Ev = {
  request?: { url: string; method: string; mode: string };
  waitUntil?: (p: Promise<unknown>) => void;
  respondWith?: (p: Promise<Response | undefined>) => void;
};

function boot(files = ['assets/index-a.js']) {
  const handlers: Record<string, (e: Ev) => void> = {};
  const self = {
    addEventListener: (type: string, fn: (e: Ev) => void) => (handlers[type] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const cache = { addAll: vi.fn(async () => {}), add: vi.fn(), put: vi.fn() };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => [] as string[]),
    delete: vi.fn(async () => true),
    match: vi.fn<(r: unknown, o?: CacheQueryOptions) => Promise<Response | undefined>>(async () => undefined),
  };
  const fetchMock = vi.fn(async (): Promise<Response> => new Response('net'));
  new Function(
    'self',
    'caches',
    'fetch',
    'Request',
    'location',
    `const CACHE = 'tribe-shell-new'; const FILES = ${JSON.stringify(files)};\n${template}`,
  )(self, caches, fetchMock, FakeRequest, new URL('https://h.test/Tribe-Fantasy/sw.js'));
  return { handlers, self, cache, caches, fetchMock };
}

/** Fires a fetch event; returns what the worker answered with, or 'ignored' if it never called respondWith. */
async function fetchEvent(w: ReturnType<typeof boot>, url: string, method = 'GET', mode = 'no-cors') {
  const respondWith = vi.fn();
  w.handlers.fetch({ request: { url, method, mode }, respondWith });
  return respondWith.mock.calls.length ? await respondWith.mock.calls[0][0] : 'ignored';
}

it("precaches the page and this build's files past the HTTP cache, then takes over at once", async () => {
  const w = boot();
  let release!: () => void;
  w.cache.addAll.mockImplementation(() => new Promise<void>((r) => (release = r)));
  const waits: Promise<unknown>[] = [];
  w.handlers.install({ waitUntil: (p) => waits.push(p) });
  await new Promise((r) => setTimeout(r, 0));
  expect(w.caches.open).toHaveBeenCalledWith('tribe-shell-new');
  const added = w.cache.addAll.mock.calls[0] as unknown as [FakeRequest[]];
  expect(added[0].map((r) => [r.url, r.init])).toEqual([
    ['./', { cache: 'reload' }],
    ['assets/index-a.js', { cache: 'reload' }],
  ]);
  expect(w.self.skipWaiting).not.toHaveBeenCalled(); // not before addAll is done
  release();
  await Promise.all(waits);
  expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
});

it('deletes only its own older shells, then claims open pages', async () => {
  const w = boot();
  w.caches.keys.mockResolvedValue(['tribe-shell-old', 'tribe-shell-new', 'other-app-v1']);
  const waits: Promise<unknown>[] = [];
  w.handlers.activate({ waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  expect(w.caches.delete).toHaveBeenCalledTimes(1);
  expect(w.caches.delete).toHaveBeenCalledWith('tribe-shell-old');
  expect(w.self.clients.claim).toHaveBeenCalledTimes(1);
  expect(w.caches.delete.mock.invocationCallOrder[0]).toBeLessThan(w.self.clients.claim.mock.invocationCallOrder[0]);
});

it('never touches Supabase, other sites or writes', async () => {
  const w = boot();
  for (const url of [
    'https://abc.supabase.co/rest/v1/teams',
    'https://abc.supabase.co/auth/v1/token',
    'https://fonts.googleapis.com/css2',
  ]) {
    expect(await fetchEvent(w, url)).toBe('ignored');
  }
  expect(await fetchEvent(w, 'https://h.test/Tribe-Fantasy/x', 'POST')).toBe('ignored');
});

it('loads pages from the network and the cached shell only when offline', async () => {
  const w = boot();
  const url = 'https://h.test/Tribe-Fantasy/?code=xyz';
  const online = new Response('new page');
  w.fetchMock.mockResolvedValueOnce(online);
  expect(await fetchEvent(w, url, 'GET', 'navigate')).toBe(online);

  const shell = new Response('shell');
  w.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
  w.caches.match.mockResolvedValueOnce(shell);
  expect(await fetchEvent(w, url, 'GET', 'navigate')).toBe(shell);
  expect(w.caches.match).toHaveBeenCalledWith('./', { ignoreVary: true, cacheName: 'tribe-shell-new' });
  expect(w.caches.open).not.toHaveBeenCalled();
  expect(w.cache.put).not.toHaveBeenCalled();
  expect(w.cache.add).not.toHaveBeenCalled();
});

it('answers an offline page with a network error, not nothing, when the shell is not cached', async () => {
  const w = boot();
  w.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
  const res = await fetchEvent(w, 'https://h.test/Tribe-Fantasy/', 'GET', 'navigate');
  expect(res).toBeInstanceOf(Response);
  expect((res as Response).type).toBe('error');
});

it("serves this build's files from the cache and anything else from the network without keeping it", async () => {
  const w = boot();
  const hit = new Response('cached');
  w.caches.match.mockResolvedValueOnce(hit);
  expect(await fetchEvent(w, 'https://h.test/Tribe-Fantasy/assets/index-a.js')).toBe(hit);
  expect(w.fetchMock).not.toHaveBeenCalled();
  // The page's crossorigin script and stylesheet requests differ from install's under Vary (Origin, Accept-Encoding).
  // Only this deploy's own cache: never an older shell or another app's cache on this origin.
  expect(w.caches.match).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'https://h.test/Tribe-Fantasy/assets/index-a.js' }), { ignoreVary: true, cacheName: 'tribe-shell-new' });

  const net = new Response('net');
  w.fetchMock.mockResolvedValueOnce(net);
  expect(await fetchEvent(w, 'https://h.test/Tribe-Fantasy/manifest.webmanifest')).toBe(net);
  expect(w.caches.open).not.toHaveBeenCalled();
  expect(w.cache.put).not.toHaveBeenCalled();
  expect(w.cache.add).not.toHaveBeenCalled();
});
