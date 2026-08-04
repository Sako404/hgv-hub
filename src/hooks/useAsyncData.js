import { useEffect, useState } from "react";

/**
 * Bridges async persistence access (Repository, always Promise-based)
 * with synchronous React rendering: runs `loader()` whenever `deps`
 * change and exposes the settled result as plain in-memory state.
 * Everything downstream of the returned `data` renders synchronously
 * over already-loaded data — no component re-queries storage during
 * render. See docs/ARCHITECTURE.md.
 * @template T
 * @param {() => Promise<T>} loader
 * @param {any[]} deps
 * @returns {{data: T|null, loading: boolean, error: Error|null}}
 */
export function useAsyncData(loader, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ data: null, loading: false, error });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
