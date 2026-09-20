import { useAuth } from '../auth/AuthContext';

// Frontend permission boundary — UX visibility ONLY, never a security gate.
// The backend Role → Permission → Data Scope guard is authoritative.
//
// Contract: session.permissions is a list of "resource:action" strings once
// the backend emits it (GET /auth/me enrichment — backend task, not yet
// present). Until then permissions is null and, per the Checkpoint 17A
// decision, gates render their children (visible-by-default) so navigation
// works on day one. NEVER gate on role names (no `role === 'Admin'`).
export function permissionKey(resource, action) {
  return `${resource}:${action}`;
}

export function usePermission(resource, action) {
  const { permissions } = useAuth();
  if (permissions == null) return true; // contract not yet provided — visible
  return permissions.includes(permissionKey(resource, action));
}

export function can(sessionPermissions, resource, action) {
  if (sessionPermissions == null) return true;
  return sessionPermissions.includes(permissionKey(resource, action));
}

export default function PermissionGate({ resource, action, children, fallback = null }) {
  const allowed = usePermission(resource, action);
  return allowed ? children : fallback;
}
