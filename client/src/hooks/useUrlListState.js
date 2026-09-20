import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

// URL-persistent list state (Checkpoint 17B convention): search, page
// (1-based in the URL), and a fixed set of string filter keys. Refresh and
// deep links reproduce the view. Only declared keys round-trip — nothing
// else is written to the URL.
const PAGE_SIZE = 20;

export function useUrlListState(filterKeys = []) {
  const [params, setParams] = useSearchParams();

  const search = params.get('search') ?? '';
  const page = Math.max(1, parseInt(params.get('page') || '1', 10) || 1);
  const filters = useMemo(() => {
    const out = {};
    for (const key of filterKeys) {
      const v = params.get(key);
      if (v != null && v !== '') out[key] = v;
    }
    return out;
  }, [params, filterKeys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const offset = (page - 1) * PAGE_SIZE;

  const setSearch = useCallback(
    (value) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set('search', value);
        else next.delete('search');
        next.delete('page');
        return next;
      });
    },
    [setParams]
  );

  const setFilter = useCallback(
    (key, value) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        next.delete('page');
        return next;
      });
    },
    [setParams]
  );

  const setPage = useCallback(
    (nextPage) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (nextPage <= 1) next.delete('page');
        else next.set('page', String(nextPage));
        return next;
      });
    },
    [setParams]
  );

  return { search, page, limit: PAGE_SIZE, offset, filters, setSearch, setFilter, setPage };
}
