// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerServiceWorker, startPwa } from './pwa';

const JS = 'https://h.test/Tribe-Fantasy/assets/index-a.js';
const CSS = 'https://h.test/Tribe-Fantasy/assets/index-a.css';
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(cached?: Response, own = [JS]) {
  const reg = { update: vi.fn(async () => {}) };
  const sw = Object.assign(new EventTarget(), { register: vi.fn(async () => reg) });
  const reload = vi.fn();
  const match = vi.fn<(u: string, o?: CacheQueryOptions) => Promise<Response | undefined>>(async () => cached);
  vi.stubGlobal('caches', { match });
  const start = () => registerServiceWorker(sw as unknown as ServiceWorkerContainer, own, reload);
  return { reg, sw, reload, match, start };
}
function show(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.spyOn(document, 'addEventListener'); // so afterEach can remove this test's listeners
});
afterEach(() => {
  for (const [type, fn] of vi.mocked(document.addEventListener).mock.calls) document.removeEventListener(type, fn);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('registers sw.js under the site path', async () => {
  vi.stubEnv('BASE_URL', '/Tribe-Fantasy/'); // vitest itself runs at '/'
  const t = setup();
  await t.start();
  expect(t.sw.register).toHaveBeenCalledWith('/Tribe-Fantasy/sw.js');
});

it('checks for a new version whenever the app comes back to the front', async () => {
  const t = setup();
  await t.start();
  show('visible');
  expect(t.reg.update).toHaveBeenCalledTimes(1);
  expect(t.match).not.toHaveBeenCalled(); // no new version took over: nothing to ask the cache

  t.reg.update.mockRejectedValue(new Error('offline')); // vitest fails the run on an unhandled rejection
  show('visible');
  await tick();
  expect(t.reg.update).toHaveBeenCalledTimes(2);
});

it('reloads on the next return once a new version has taken over', async () => {
  const t = setup(undefined);
  await t.start();
  t.sw.dispatchEvent(new Event('controllerchange'));
  await tick();
  expect(t.reload).not.toHaveBeenCalled(); // never while someone is using it
  show('visible');
  await tick();
  expect(t.match).toHaveBeenCalledWith(JS, { ignoreVary: true }); // asks about this page's own bundle
  expect(t.reload).toHaveBeenCalledTimes(1);
  expect(t.reg.update).not.toHaveBeenCalled();
});

it('reloads even if the old shell was still there when the new version took over', async () => {
  // controllerchange comes before the new worker's activate step has deleted the old shell.
  const t = setup(new Response('old shell'));
  await t.start();
  t.sw.dispatchEvent(new Event('controllerchange'));
  await tick();
  t.match.mockResolvedValue(undefined); // activate has now deleted it
  show('visible');
  await tick();
  expect(t.reload).toHaveBeenCalledTimes(1);
});

it('never reloads a page that is already the new version', async () => {
  const t = setup(new Response('own file'), [JS, CSS]);
  await t.start();
  t.sw.dispatchEvent(new Event('controllerchange'));
  await tick();
  show('visible');
  await tick();
  expect(t.match).toHaveBeenCalledWith(JS, { ignoreVary: true });
  expect(t.match).toHaveBeenCalledWith(CSS, { ignoreVary: true });
  expect(t.reload).not.toHaveBeenCalled();
  expect(t.reg.update).toHaveBeenCalledTimes(1);
});

it('reloads a page whose bundle is still cached but whose stylesheet is not (a CSS-only deploy)', async () => {
  const t = setup(undefined, [JS, CSS]);
  t.match.mockImplementation(async (u) => (u === JS ? new Response('same bundle') : undefined));
  await t.start();
  t.sw.dispatchEvent(new Event('controllerchange'));
  show('visible');
  await tick();
  expect(t.match).toHaveBeenCalledWith(CSS, { ignoreVary: true });
  expect(t.reload).toHaveBeenCalledTimes(1);
  expect(t.reg.update).not.toHaveBeenCalled();
});

it("checks the running bundle and this site's own stylesheets, never another site's", async () => {
  vi.stubEnv('PROD', true);
  const t = setup(new Response('cached'));
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: t.sw });
  document.head.innerHTML = '<link rel="stylesheet" href="/Tribe-Fantasy/assets/index-b.css">' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo">';
  try {
    startPwa();
    await tick();
    t.sw.dispatchEvent(new Event('controllerchange'));
    show('visible');
    await tick();
    expect(t.match.mock.calls.map(([u]) => u)).toEqual([
      expect.stringMatching(/pwa\.ts/), // import.meta.url: the entry bundle in a build
      `${location.origin}/Tribe-Fantasy/assets/index-b.css`,
    ]);
  } finally {
    Reflect.deleteProperty(navigator, 'serviceWorker');
    document.head.innerHTML = '';
  }
});

it("never reloads a keeper's tally board mid-game; reloads on a later return without it", async () => {
  const t = setup(undefined);
  await t.start();
  t.sw.dispatchEvent(new Event('controllerchange'));
  document.body.innerHTML = '<div class="tally-bar"></div>';
  try {
    show('visible');
    await tick();
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.reg.update).toHaveBeenCalledTimes(1);
  } finally {
    document.body.innerHTML = '';
  }
  show('visible');
  await tick();
  expect(t.reload).toHaveBeenCalledTimes(1);
});

it('never reloads offline; reloads on a later return once online', async () => {
  const t = setup(undefined);
  await t.start();
  t.sw.dispatchEvent(new Event('controllerchange'));
  const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  show('visible');
  await tick();
  expect(t.reload).not.toHaveBeenCalled();
  expect(t.reg.update).toHaveBeenCalledTimes(1);
  onLine.mockReturnValue(true);
  show('visible');
  await tick();
  expect(t.reload).toHaveBeenCalledTimes(1);
});

it('does nothing while hidden', async () => {
  const t = setup(undefined);
  await t.start();
  t.sw.dispatchEvent(new Event('controllerchange'));
  await tick();
  show('hidden');
  await tick();
  expect(t.reg.update).not.toHaveBeenCalled();
  expect(t.reload).not.toHaveBeenCalled();
});

it('counts a failed cache lookup as found: no reload, just the update check', async () => {
  const t = setup();
  t.match.mockRejectedValue(new Error('cache storage blocked')); // vitest fails the run on an unhandled rejection
  await t.start();
  t.sw.dispatchEvent(new Event('controllerchange'));
  show('visible');
  await tick();
  expect(t.reload).not.toHaveBeenCalled();
  expect(t.reg.update).toHaveBeenCalledTimes(1);
});

it('never stops the app starting, even where the worker API throws', () => {
  vi.stubEnv('PROD', true);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true, get: () => { throw new DOMException('opaque origin', 'SecurityError'); },
  });
  try {
    expect(() => startPwa()).not.toThrow();
  } finally {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  }
});
