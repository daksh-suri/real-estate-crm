import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext';

// Server-state hook over the guarded api(): GET-on-mount with cancel,
// manual retry, and no caching beyond the component lifetime. (Per the 17A
// decision: plain hooks + fetch, no query library. Revisit only when list
// screens prove they need cross-screen caching.)
export function useApi(path, { enabled = true, options } = {}) {
  const { api, status } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const abortRef = useRef(null);

  const load = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await api(path, { ...options, signal: controller.signal });
      setData(res);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api, path, JSON.stringify(options ?? null)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled || status !== 'authenticated') {
      setLoading(false);
      return undefined;
    }
    load();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [enabled, status, load]);

  return { data, error, loading, retry: load };
}
