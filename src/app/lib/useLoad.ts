import { useCallback, useEffect, useState, type DependencyList } from 'react';
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
