import { describe, test, expect, vi } from 'vitest';
import { sharedBootSequence, restoreSession } from '../AuthContext';

// The boot refresh consumes a single-use cookie: concurrent mounts (React
// StrictMode remounts) must share one sequence, and the shared slot must
// clear on settle so the next genuine boot refreshes fresh.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('sharedBootSequence', () => {
  test('concurrent callers share one run', async () => {
    let runs = 0;
    const gate = deferred();
    const run = async () => {
      runs += 1;
      await gate.promise;
      return { token: 't' };
    };
    const a = sharedBootSequence(run);
    const b = sharedBootSequence(run);
    expect(runs).toBe(1);
    gate.resolve();
    await expect(a).resolves.toEqual({ token: 't' });
    await expect(b).resolves.toEqual({ token: 't' });
    expect(runs).toBe(1);
  });

  test('slot clears on success: the next boot runs fresh', async () => {
    let runs = 0;
    await sharedBootSequence(async () => {
      runs += 1;
      return 'first';
    });
    await expect(sharedBootSequence(async () => {
      runs += 1;
      return 'second';
    })).resolves.toBe('second');
    expect(runs).toBe(2);
  });

  test('rejection reaches every waiter and still clears the slot', async () => {
    let runs = 0;
    const failing = () => sharedBootSequence(async () => {
      runs += 1;
      throw new Error('refresh 401');
    });
    const a = failing();
    const b = failing();
    await expect(a).rejects.toThrow('refresh 401');
    await expect(b).rejects.toThrow('refresh 401');
    expect(runs).toBe(1);
    // Next genuine boot tries again instead of replaying the failure.
    await expect(sharedBootSequence(async () => 'recovered')).resolves.toBe('recovered');
    expect(runs).toBe(1);
  });

  test('late attacher after settle starts a fresh run, never a stale session', async () => {
    await sharedBootSequence(async () => 'settled');
    let runs = 0;
    await expect(sharedBootSequence(async () => {
      runs += 1;
      return 'fresh';
    })).resolves.toBe('fresh');
    expect(runs).toBe(1);
  });
});

describe('restoreSession (refresh → store → me ordering)', () => {
  test('/me is fetched only after the fresh token is stored (boot regression)', async () => {
    const seen = [];
    let stored = null;
    const refresh = async () => ({ accessToken: 'fresh-token' });
    const fetchMe = async () => {
      seen.push(stored);
      return { user: { id: 'u' } };
    };
    const setToken = (t) => {
      stored = t;
    };
    const session = await restoreSession({ refresh, fetchMe, setToken });
    // The /me call must have observed the fresh token — never null/stale.
    expect(seen).toEqual(['fresh-token']);
    expect(session).toEqual({ token: 'fresh-token', user: { id: 'u' } });
  });

  test('refresh failure throws before any store or me call', async () => {
    const fetchMe = vi.fn();
    const setToken = vi.fn();
    await expect(restoreSession({
      refresh: async () => {
        throw new Error('refresh 401');
      },
      fetchMe,
      setToken,
    })).rejects.toThrow('refresh 401');
    expect(setToken).not.toHaveBeenCalled();
    expect(fetchMe).not.toHaveBeenCalled();
  });
});
