// Role → Permission → Data Scope reads (Checkpoint 18, DEC-039).
// Read-only: the permission mapping is org-configurable in principle, but no
// grant/revoke endpoint exists in V1 — the matrix UI presents the current
// configuration, it never writes it. Backend authorization stays
// authoritative; frontend gates remain UX-only.
const { prisma } = require('../../lib/prisma');

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
      resource: rp.permission.resource,
      action: rp.permission.action,
      scope: rp.scope,
    })),
  }));
}

async function listPermissions() {
  // Permission is the global catalogue (no organizationId) — same rows every
  // tenant sees; the per-org difference is the RolePermission mapping above.
  const rows = await prisma.permission.findMany({
    select: { resource: true, action: true },
    orderBy: [{ resource: 'asc' }, { action: 'asc' }],
  });
  return rows;
}

module.exports = { listRoles, listPermissions };
