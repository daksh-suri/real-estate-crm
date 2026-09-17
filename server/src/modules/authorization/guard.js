const { prisma } = require('../../lib/prisma');

// Centralized authorization guard — the ONLY place that checks (role, scope, resource:action)
// Usage: app.get('/leads', authenticate, authorize('lead', 'read'), handler)
//        app.post('/leads', authenticate, authorize('lead', 'create'), handler)
//        app.post('/leads/:id/assign', authenticate, authorize('lead', 'assign', { scope: 'TEAM' }), handler)

function authorize(resource, action, options = {}) {
  if (!resource || !action) {
    throw new Error('authorize() requires resource and action');
  }
  const requiredScope = options.scope || null; // e.g., 'OWN', 'TEAM', etc.

  return async (req, _res, next) => {
    try {
      // Must be authenticated first
      if (!req.user || !req.auth || !req.tenantPrisma) {
        const err = new Error('Authorization requires authentication');
        err.statusCode = 401;
        return next(err);
      }

      const user = req.user;

      // DEACTIVATED already blocked by authenticate, but double-check
      if (user.status === 'DEACTIVATED' || user.deletedAt) {
        const err = new Error('Account deactivated');
        err.statusCode = 403;
        return next(err);
      }

      if (!user.roleId) {
        const err = new Error(`Missing role for user ${user.id}`);
        err.statusCode = 403;
        return next(err);
      }

      // Role must belong to same organization — use tenant-scoped fetch
      const role = await req.tenantPrisma.role.findUnique({ where: { id: user.roleId } });
      if (!role) {
        const err = new Error('Role not found or cross-tenant');
        err.statusCode = 403;
        return next(err);
      }

      // Permission is global catalogue
      const permission = await prisma.permission.findUnique({
        where: { resource_action: { resource, action } },
      });
      // Fallback for case where compound unique key name is different (resource_action)
      // Prisma generates unique name as resource_action for @@unique([resource, action])
      // If not found, try findFirst
      let perm = permission;
      if (!perm) {
        perm = await prisma.permission.findFirst({ where: { resource, action } });
      }
      if (!perm) {
        const err = new Error(`Permission ${resource}:${action} not found`);
        err.statusCode = 403;
        return next(err);
      }

      // Find RolePermission for this role+permission, filtered by organization (tenant)
      // RolePermission is tenant-scoped, so tenantPrisma will filter by organizationId
      const whereBase = { roleId: role.id, permissionId: perm.id };
      let rolePermissions;
      if (requiredScope) {
        if (!['OWN', 'TEAM', 'PROJECT', 'ORGANIZATION'].includes(requiredScope)) {
          const err = new Error(`Invalid scope ${requiredScope}`);
          err.statusCode = 403;
          return next(err);
        }
        // Exact scope match — do not fallback to ORGANIZATION
        rolePermissions = await req.tenantPrisma.rolePermission.findMany({
          where: { ...whereBase, scope: requiredScope },
        });
      } else {
        rolePermissions = await req.tenantPrisma.rolePermission.findMany({
          where: whereBase,
        });
      }

      if (!rolePermissions || rolePermissions.length === 0) {
        const err = new Error(`Forbidden: missing permission ${resource}:${action}${requiredScope ? ` with scope ${requiredScope}` : ''}`);
        err.statusCode = 403;
        return next(err);
      }

      // Attach authorization context for downstream scope filtering
      const allowedScopes = rolePermissions.map((rp) => rp.scope);
      req.authorization = {
        resource,
        action,
        allowedScopes,
        requiredScope,
        role,
        permission: perm,
      };

      // For PROJECT scope, if permission requires PROJECT but no project context exists,
      // we do not automatically upgrade to ORGANIZATION — fail closed with explicit message
      if (requiredScope === 'PROJECT') {
        // Project model does not exist at checkpoint 3
        // Require that handler provides project context; guard itself just verifies scope exists
        // We do not deny here solely because project not yet implemented, but we note that
        // resource-level project check must be done by business logic.
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}

// Helper for testing: check if user has permission without middleware
async function hasPermission({ user, tenantPrisma, resource, action, scope = null }) {
  if (!user.roleId) return false;
  const role = await tenantPrisma.role.findUnique({ where: { id: user.roleId } });
  if (!role) return false;
  const perm = await prisma.permission.findFirst({ where: { resource, action } });
  if (!perm) return false;
  const where = { roleId: role.id, permissionId: perm.id };
  if (scope) where.scope = scope;
  const rp = await tenantPrisma.rolePermission.findFirst({ where });
  return !!rp;
}

const FIXED_ROLES = ['Agent', 'Team Lead', 'Manager', 'Operations/Accounts', 'Admin'];

module.exports = { authorize, hasPermission, FIXED_ROLES };
