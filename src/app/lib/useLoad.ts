import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { errorMessage } from './errors';

export function useLoad<T>(load: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const waiting = useRef<((fresh: boolean) => void)[]>([]);
  useEffect(() => {
    let live = true;
    const queue = waiting.current; // one array for the hook's life
    // The reload() calls this load answers: only a load started after the call shows what the caller just saved.
    const asked = queue.splice(0);
    const answer = (fresh: boolean) => { for (const done of asked.splice(0)) done(fresh); };
    load().then(
      (d) => { if (live) { setData(d); setError(null); answer(true); } },
      (e) => { if (live) { setError(errorMessage(e)); answer(false); } },
    );
    return () => { live = false; queue.push(...asked.splice(0)); }; // replaced: the next load answers them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  // Stable identity, so callers can list reload in effect/callback deps without re-running them every render.
  // Settles once a load started by this call lands, with data or an error, so a caller can wait for fresh data:
  // true when it brought data, false when it failed (the old data stays).
  const reload = useCallback(() => new Promise<boolean>((done) => { waiting.current.push(done); setTick((t) => t + 1); }), []);
  return { data, error, reload };
}

/**
 * `reload()` whenever the tab becomes visible again: a home-screen app back from another app (Messages, say) shows
 * fresh data without a tab change (X11).
 */
export function useReloadOnShow(reload: () => void): void {
  const latest = useRef(reload);
  useEffect(() => { latest.current = reload; });
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'visible') latest.current(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}

/**
 * `reload()` every `ms` while `on` and the tab is visible, and at once whenever the tab becomes visible again, polling
 * or not (useReloadOnShow). No timer while `on` is false.
 */
export function usePoll(reload: () => void, on: boolean, ms = 15_000): void {
  const latest = useRef(reload);
  useEffect(() => { latest.current = reload; });
  useReloadOnShow(reload);
  useEffect(() => {
    if (!on) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const arm = () => {
      clearInterval(timer);
      timer = document.visibilityState === 'visible' ? setInterval(() => latest.current(), ms) : undefined;
    };
    arm();
    document.addEventListener('visibilitychange', arm);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', arm); };
  }, [on, ms]);
}
