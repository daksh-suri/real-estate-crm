import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../lib/apiClient';
import { createSessionManager } from './sessionManager';

// Session boundary: the ONLY owner of tokens and auth state.
// - Access token lives in memory (a ref mirrored to state for renders).
// - Refresh travels on the HttpOnly cookie; the raw token is never stored.
// - All authenticated traffic goes through `api()`, which is the session
//   manager's guarded request: single refresh + single flagged replay.
// - logout() is idempotent — concurrent 401 handlers may all call it.
const AuthContext = createContext(null);

// In-flight boot only — never a cached session. Concurrent mounts (notably
// React StrictMode remounts in dev) share one refresh→me sequence so the
// single-use refresh cookie is consumed exactly once. Cleared on settle so
// every genuine boot performs a fresh refresh. No token/user/status lives
// here, ever.
let bootInflight = null;

export function sharedBootSequence(run) {
  if (!bootInflight) {
    bootInflight = run().finally(() => {
      bootInflight = null;
    });
  }
  return bootInflight;
}

// One boot attempt: refresh, store the fresh token FIRST, then load /me so
// it is sent with the fresh token (a stale/null token here 401s every boot
// and logs the user out). Pure sequencing over injected callbacks —
// unit-tested without a renderer.
export async function restoreSession({ refresh, fetchMe, setToken }) {
  const res = await refresh();
  setToken(res.accessToken);
  const me = await fetchMe();
  return { token: res.accessToken, ...me };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [permissions, setPermissions] = useState(null); // null = contract not yet provided by backend
  const [status, setStatus] = useState('booting'); // booting | authenticated | unauthenticated
  const tokenRef = useRef(null);

  const applySession = useCallback((session) => {
    tokenRef.current = session.token;
    setUser(session.user ?? null);
    setOrganization(session.organization ?? null);
    // Backend does not emit a permission list yet — stays null until it does.
    setPermissions(session.permissions ?? null);
    setStatus(session.user ? 'authenticated' : 'unauthenticated');
  }, []);

  const logout = useCallback(() => {
    tokenRef.current = null;
    setUser(null);
    setOrganization(null);
    setPermissions(null);
    setStatus((prev) => (prev === 'unauthenticated' ? prev : 'unauthenticated'));
  }, []);

  const managerRef = useRef(null);
  if (!managerRef.current) {
    managerRef.current = createSessionManager({
      rawRequest: (path, opts = {}) =>
        apiRequest(path, { ...opts, token: opts.withToken === false ? undefined : tokenRef.current }),
      doRefresh: async () => {
        // Bootstrap path: failure here goes straight to unauthenticated
        // (sessionManager flags nothing — doRefresh rejection latches).
        const res = await apiRequest('/auth/refresh', { method: 'POST', bootstrap: true });
        tokenRef.current = res.accessToken;
        return res.accessToken;
      },
      onUnauthenticated: () => {
        logout();
      },
    });
  }

  const api = useCallback((path, opts) => managerRef.current.request(path, opts), []);

  const login = useCallback(
    async ({ email, password }) => {
      const res = await managerRef.current.request('/auth/login', {
        method: 'POST',
        body: { email, password },
        bootstrap: true,
        withToken: false,
      });
      tokenRef.current = res.accessToken;
      managerRef.current.resetOnLogin();
      const me = await managerRef.current.request('/auth/me', { bootstrap: true });
      applySession({ token: res.accessToken, ...me });
      return me;
    },
    [applySession]
  );

  const signup = useCallback(
    async ({ organizationName, name, email, password, confirmPassword }) => {
      const res = await managerRef.current.request('/auth/signup', {
        method: 'POST',
        body: { organizationName, name, email, password, confirmPassword },
        bootstrap: true,
        withToken: false,
      });
      tokenRef.current = res.accessToken;
      managerRef.current.resetOnLogin();
      const me = await managerRef.current.request('/auth/me', { bootstrap: true });
      applySession({ token: res.accessToken, ...me });
      return me;
    },
    [applySession]
  );

  const logoutRemote = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST', token: tokenRef.current });
    } catch {
      // Logout is best-effort; local state clears regardless.
    }
    logout();
  }, [logout]);

  // Boot: cookie refresh → me. Both bootstrap-flagged, so any failure lands
  // directly unauthenticated without ever touching the refresh path again.
  // The sequence is single-flight across mounts (see sharedBootSequence):
  // a remount awaits the running boot instead of consuming the refresh
  // cookie a second time.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await sharedBootSequence(() =>
          restoreSession({
            refresh: () => managerRef.current.request('/auth/refresh', { method: 'POST', bootstrap: true, withToken: false }),
            fetchMe: () => managerRef.current.request('/auth/me', { bootstrap: true }),
            setToken: (t) => {
              tokenRef.current = t;
            },
          })
        );
        if (cancelled) return;
        applySession(session);
      } catch {
        if (!cancelled) logout();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession, logout]);

  const value = useMemo(
    () => ({ user, organization, permissions, status, api, login, signup, logout: logoutRemote }),
    [user, organization, permissions, status, api, login, signup, logoutRemote]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
