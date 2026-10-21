import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { errorMessage } from './errors';

export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then(
      (d) => { if (live) { setData(d); setError(null); } },
      (e) => { if (live) setError(errorMessage(e)); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  // Stable identity, so callers can list reload in effect/callback deps without re-running them every render.
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}

/** `reload()` every `ms` while `on` and the tab is visible; at once when it becomes visible again; never otherwise. */
export function usePoll(reload: () => void, on: boolean, ms = 15_000): void {
  const latest = useRef(reload);
  useEffect(() => { latest.current = reload; });
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const arm = () => {
      clearInterval(timer);
      timer = document.visibilityState === 'visible' ? setInterval(() => latest.current(), ms) : undefined;
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') latest.current(); arm(); };
    arm();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [on, ms]);
}
