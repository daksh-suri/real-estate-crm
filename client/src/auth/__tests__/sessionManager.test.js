import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createSessionManager } from '../sessionManager';
import { ApiError } from '../../lib/apiErrors';

const unauthorized = () => new ApiError(401, 'Unauthorized');

describe('sessionManager 401 orchestration (exact fetch counts)', () => {
  let counts;
  let onUnauthenticated;

  beforeEach(() => {
    counts = { data: 0, refresh: 0 };
    onUnauthenticated = vi.fn();
  });

  // Data endpoint: first `failures` calls 401, then succeeds.
  function dataEndpoint(failures = Infinity) {
    return async () => {
      counts.data += 1;
      if (counts.data <= failures) throw unauthorized();
      return { ok: true, n: counts.data };
    };
  }

  function refreshOk() {
    return async () => {
      counts.refresh += 1;
      return 'new-token';
    };
  }

  function refreshDead() {
    return async () => {
      counts.refresh += 1;
      throw unauthorized();
    };
  }

  test('1. three concurrent data 401s → one refresh → three successful replays', async () => {
    const mgr = createSessionManager({ rawRequest: dataEndpoint(3), doRefresh: refreshOk(), onUnauthenticated });
    const results = await Promise.all([mgr.request('/deals'), mgr.request('/deals'), mgr.request('/deals')]);
    expect(counts.refresh).toBe(1);
    expect(counts.data).toBe(6); // 3 initials + 3 per-caller replays
    expect(results).toHaveLength(3);
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  test('2. refresh 401 → no replay and no second refresh', async () => {
    const mgr = createSessionManager({ rawRequest: dataEndpoint(), doRefresh: refreshDead(), onUnauthenticated });
    const outcomes = await Promise.allSettled([mgr.request('/deals'), mgr.request('/deals'), mgr.request('/deals')]);
    expect(counts.refresh).toBe(1);
    expect(counts.data).toBe(3); // initials only — zero replays
    expect(outcomes.every((o) => o.status === 'rejected')).toBe(true);
    expect(onUnauthenticated).toHaveBeenCalled();
  });

  test('3. replay 401 → no second refresh', async () => {
    const mgr = createSessionManager({ rawRequest: dataEndpoint(), doRefresh: refreshOk(), onUnauthenticated });
    const outcomes = await Promise.allSettled([mgr.request('/leads')]);
    expect(counts.refresh).toBe(1);
    expect(counts.data).toBe(2); // initial + exactly one replay
    expect(outcomes[0].status).toBe('rejected');
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  test('4. /auth/me 401 → no refresh call', async () => {
    const me = async () => {
      throw unauthorized();
    };
    const mgr = createSessionManager({ rawRequest: me, doRefresh: refreshOk(), onUnauthenticated });
    await expect(mgr.request('/auth/me', { bootstrap: true })).rejects.toMatchObject({ status: 401 });
    expect(counts.refresh).toBe(0);
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  test('5. login 401 → thrown for inline error, no refresh', async () => {
    const login = async () => {
      throw unauthorized();
    };
    const mgr = createSessionManager({ rawRequest: login, doRefresh: refreshOk(), onUnauthenticated });
    await expect(mgr.request('/auth/login', { bootstrap: true, method: 'POST' })).rejects.toMatchObject({ status: 401 });
    expect(counts.refresh).toBe(0);
  });

  test('6. successful login resets the refreshFailed latch', async () => {
    let refreshWorks = false;
    const doRefresh = async () => {
      counts.refresh += 1;
      if (!refreshWorks) throw unauthorized();
      return 'new-token';
    };
    const mgr = createSessionManager({ rawRequest: dataEndpoint(3), doRefresh, onUnauthenticated });

    // First incident: refresh fails → latch sets (no replay).
    await expect(mgr.request('/deals')).rejects.toMatchObject({ status: 401 });
    expect(counts.refresh).toBe(1);
    expect(counts.data).toBe(1);

    // Latched: the next 401 must not trigger another refresh.
    await expect(mgr.request('/deals')).rejects.toMatchObject({ status: 401 });
    expect(counts.refresh).toBe(1);
    expect(counts.data).toBe(2);

    // Explicit successful login resets the latch; the next incident may
    // refresh again and its replay succeeds.
    mgr.resetOnLogin();
    refreshWorks = true;
    await expect(mgr.request('/deals')).resolves.toEqual({ ok: true, n: 4 });
    expect(counts.refresh).toBe(2);
    expect(counts.data).toBe(4); // two failed initials + one failed initial + one replay
  });
});
