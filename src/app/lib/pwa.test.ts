// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerServiceWorker, startPwa } from './pwa';

const OWN = 'https://h.test/Tribe-Fantasy/assets/index-a.js';
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(cached?: Response) {
  const reg = { update: vi.fn(async () => {}) };
  const sw = Object.assign(new EventTarget(), { register: vi.fn(async () => reg) });
  const reload = vi.fn();
  const match = vi.fn(async (): Promise<Response | undefined> => cached);
  vi.stubGlobal('caches', { match });
  const start = () => registerServiceWorker(sw as unknown as ServiceWorkerContainer, OWN, reload);
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
  expect(t.match).toHaveBeenCalledWith(OWN); // asks about this page's own bundle
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
  const t = setup(new Response('own file'));
  await t.start();
  t.sw.dispatchEvent(new Event('controllerchange'));
  await tick();
  show('visible');
  await tick();
  expect(t.reload).not.toHaveBeenCalled();
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
