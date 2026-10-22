// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './pwa';

const OWN = 'https://h.test/Tribe-Fantasy/assets/index-a.js';
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(cached?: Response) {
  vi.spyOn(document, 'addEventListener'); // so afterEach can remove this test's listeners
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

afterEach(() => {
  for (const [type, fn] of vi.mocked(document.addEventListener).mock.calls) document.removeEventListener(type, fn);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('registers sw.js under the site path', async () => {
  const t = setup();
  await t.start();
  expect(t.sw.register).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}sw.js`);
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
