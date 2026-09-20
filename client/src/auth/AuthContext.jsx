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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [role, setRole] = useState(null);
  const [teamIds, setTeamIds] = useState([]);
  const [permissions, setPermissions] = useState(null); // null = contract not yet provided by backend
  const [status, setStatus] = useState('booting'); // booting | authenticated | unauthenticated
  const [expired, setExpired] = useState(false);
  const tokenRef = useRef(null);

  const applySession = useCallback((session) => {
    tokenRef.current = session.token;
    setUser(session.user ?? null);
    setOrganization(session.organization ?? null);
    setRole(session.role ?? null);
    setTeamIds(session.teamIds ?? []);
    // Backend does not emit a permission list yet — stays null until it does.
    setPermissions(session.permissions ?? null);
    setExpired(false);
    setStatus(session.user ? 'authenticated' : 'unauthenticated');
  }, []);

  const logout = useCallback(() => {
    tokenRef.current = null;
    setUser(null);
    setOrganization(null);
    setRole(null);
    setTeamIds([]);
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
        setExpired(true);
        logout();
      },
    });
  }

  const api = useCallback((path, opts) => managerRef.current.request(path, opts), []);

  const login = useCallback(
    async ({ email, password, organizationId }) => {
      // Bootstrap call: a 401 here is bad credentials — inline error only,
      // no refresh, no navigation (enforced by bootstrap flag + this shape).
      const res = await managerRef.current.request('/auth/login', {
        method: 'POST',
        body: { email, password, organizationId },
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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
      const res = await managerRef.current.request('/auth/refresh', { method: 'POST', bootstrap: true, withToken: false });
        if (cancelled) return;
        tokenRef.current = res.accessToken;
        const me = await managerRef.current.request('/auth/me', { bootstrap: true });
        if (cancelled) return;
        applySession({ token: res.accessToken, ...me });
      } catch {
        if (!cancelled) logout();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession, logout]);

  const value = useMemo(
    () => ({ user, organization, role, teamIds, permissions, status, expired, api, login, logout: logoutRemote }),
    [user, organization, role, teamIds, permissions, status, expired, api, login, logoutRemote]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
