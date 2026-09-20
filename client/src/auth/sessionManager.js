// Loop-proof 401 orchestration (Checkpoint 17A auth requirements).
//
// Framework-free so the exact fetch-count behavior is unit-testable.
// Wiring (tokens, navigation) lives in AuthContext; this module owns ONLY
// the refresh/replay state machine:
//
// - rawRequest: single-attempt request (path, opts) -> parsed JSON.
// - doRefresh: performs the refresh, resolves when the session is renewed,
//   rejects when it is not. Must itself never trigger this manager.
// - onUnauthenticated: terminal transition (idempotent in the caller).
//
// Internal opts (never sent on the wire):
// - bootstrap: boot/login/refresh-adjacent calls. A 401 here goes straight
//   to unauthenticated — never a refresh (cuts boot recursion).
// - replayed: set on the single replay. A 401 on a replay goes straight to
//   unauthenticated — never a second refresh (cuts replay recursion).
//
// Guards:
// - refreshInFlight: concurrent 401s share one refresh promise; cleared in
//   `finally` when it settles.
// - refreshFailed: latched on any refresh failure; reset ONLY by
//   resetOnLogin() after an explicit successful user login.
export function createSessionManager({ rawRequest, doRefresh, onUnauthenticated }) {
  let refreshInFlight = null;
  let refreshFailed = false;

  function sharedRefresh() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        return await doRefresh();
      } catch (err) {
        refreshFailed = true;
        throw err;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  }

  async function request(path, opts = {}) {
    try {
      return await rawRequest(path, opts);
    } catch (err) {
      const isAuthFailure = err && err.status === 401;
      if (!isAuthFailure || opts.bootstrap || opts.replayed || refreshFailed) {
        if (isAuthFailure) onUnauthenticated();
        throw err;
      }
      // Eligible for exactly one shared refresh.
      try {
        await sharedRefresh();
      } catch {
        onUnauthenticated();
        throw err;
      }
      // Replay exactly once, flagged so a second 401 cannot refresh again.
      try {
        return await rawRequest(path, { ...opts, replayed: true });
      } catch (replayErr) {
        if (replayErr && replayErr.status === 401) onUnauthenticated();
        throw replayErr;
      }
    }
  }

  function resetOnLogin() {
    refreshFailed = false;
  }

  function isRefreshLatched() {
    return refreshFailed;
  }

  return { request, resetOnLogin, isRefreshLatched };
}
