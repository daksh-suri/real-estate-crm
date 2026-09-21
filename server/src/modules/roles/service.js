// Role → Permission → Data Scope (Checkpoint 18, DEC-039, DEC-042).
// Reads: listRoles + listPermissions (catalogue). Writes: createRole + replaceRolePermissions — atomic.
const { prisma } = require('../../lib/prisma');
const { conflictError, notFoundError, badRequestError } = require('../../lib/httpError');

async function listRoles({ tenantPrisma }) {
  const rows = await tenantPrisma.role.findMany({
    include: {
      permissions: { include: { permission: { select: { resource: true, action: true } } } },
    },
    orderBy: { name: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    permissions: r.permissions.map((rp) => ({
      permissionId: rp.permissionId,
      resource: rp.permission.resource,
      action: rp.permission.action,
      scope: rp.scope,
    })),
  }));
}

async function listPermissions() {
  const rows = await prisma.permission.findMany({
    select: { id: true, resource: true, action: true },
    orderBy: [{ resource: 'asc' }, { action: 'asc' }],
  });
  return rows;
}

function assertNoDuplicatePermissions(items) {
  const seen = new Set();
  for (const it of items) {
    const key = `${it.permissionId}:${it.scope}`;
    if (seen.has(key)) {
      const err = new Error('Duplicate permission assignment');
      err.statusCode = 400;
      throw err;
    }
    seen.add(key);
  }
}

async function createRole({ tenantPrisma, organizationId, name, permissions }) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw badRequestError('Role name required');
  }
  const items = permissions || [];
  assertNoDuplicatePermissions(items);

  // Validate permissions exist (global catalogue) before opening transaction
  for (const it of items) {
    const perm = await prisma.permission.findUnique({ where: { id: it.permissionId } });
    if (!perm) throw badRequestError(`Permission ${it.permissionId} not found`);
  }

  try {
    const result = await tenantPrisma.$transaction(async (tx) => {
      const role = await tx.role.create({ data: { name: trimmed } });
      for (const it of items) {
        // Re-validate inside tx for race where permission was deleted after pre-check
        const perm = await tx.permission.findUnique({ where: { id: it.permissionId } });
        if (!perm) throw badRequestError(`Permission ${it.permissionId} not found`);
        await tx.rolePermission.create({
          data: {
            roleId: role.id,
            permissionId: it.permissionId,
            scope: it.scope,
          },
        });
      }
      // Fetch with permissions for response
      const full = await tx.role.findUnique({
        where: { id: role.id },
        include: { permissions: { include: { permission: { select: { resource: true, action: true } } } } },
      });
      return {
        id: full.id,
        name: full.name,
        permissions: full.permissions.map((rp) => ({
          permissionId: rp.permissionId,
          resource: rp.permission.resource,
          action: rp.permission.action,
          scope: rp.scope,
        })),
      };
    }, { timeout: 10000, maxWait: 5000 });
    return result;
  } catch (err) {
    if (err.code === 'P2002') {
      const target = err.meta && err.meta.target ? String(err.meta.target) : '';
      if (target.includes('organizationId') || target.includes('name')) {
        throw conflictError('Role name already exists in this organization');
      }
      throw conflictError('Duplicate entry');
    }
    throw err;
  }
}

async function replaceRolePermissions({ tenantPrisma, organizationId, roleId, permissions }) {
  const items = permissions || [];
  assertNoDuplicatePermissions(items);
  for (const it of items) {
    const perm = await prisma.permission.findUnique({ where: { id: it.permissionId } });
    if (!perm) throw badRequestError(`Permission ${it.permissionId} not found`);
  }

  // Verify role exists and belongs to tenant (tenantPrisma read hides cross-tenant as null → 404)
  const existing = await tenantPrisma.role.findUnique({ where: { id: roleId } });
  if (!existing) {
    // Distinguish cross-tenant vs not found: raw check
    const raw = await prisma.role.findUnique({ where: { id: roleId } });
    if (raw && raw.organizationId !== organizationId) {
      // Must be 404 per tenant-isolation (hide existence, same as GET /roles/:id)
      throw notFoundError('Role not found');
    }
    throw notFoundError('Role not found');
  }

  try {
    const result = await tenantPrisma.$transaction(async (tx) => {
      // Re-validate permissions inside tx
      for (const it of items) {
        const perm = await tx.permission.findUnique({ where: { id: it.permissionId } });
        if (!perm) throw badRequestError(`Permission ${it.permissionId} not found`);
      }
      // Atomic replace: delete existing, create new
      await tx.rolePermission.deleteMany({ where: { roleId } });
      for (const it of items) {
        await tx.rolePermission.create({
          data: {
            roleId,
            permissionId: it.permissionId,
            scope: it.scope,
          },
        });
      }
      const full = await tx.role.findUnique({
        where: { id: roleId },
        include: { permissions: { include: { permission: { select: { resource: true, action: true } } } } },
      });
      return {
        id: full.id,
        name: full.name,
        permissions: full.permissions.map((rp) => ({
          permissionId: rp.permissionId,
          resource: rp.permission.resource,
          action: rp.permission.action,
          scope: rp.scope,
        })),
      };
    }, { timeout: 10000, maxWait: 5000 });
    return result;
  } catch (err) {
    if (err.statusCode) throw err;
    throw err;
  }
}

module.exports = { listRoles, listPermissions, createRole, replaceRolePermissions };
