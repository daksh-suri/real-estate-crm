// Organization user directory + employee provisioning (Checkpoint 18).
// Reads expose only the fields the Team UI needs — passwordHash never leaves
// the service. Role assignment reuses the refs convention (cross-tenant →
// 403, missing → 404). No status transitions, no deactivation, no invite
// flow here: those are intentionally deferred (see DEC-039).
const { hashPassword } = require('../../lib/bcrypt');
const { resolveRef } = require('../../lib/refs');
const { conflictError, notFoundError } = require('../../lib/httpError');

function presentUser(row) {
  if (!row) return row;
  const { passwordHash, memberships, role, ...safe } = row;
  void passwordHash;
  return {
    ...safe,
    roleName: role ? role.name : null,
    teams: (memberships || [])
      .map((m) => m.team)
      .filter(Boolean)
      .map((t) => ({ id: t.id, name: t.name })),
  };
}

async function listUsers({ tenantPrisma, filters = {}, limit = 20, offset = 0 }) {
  const where = {};
  if (filters.search) {
    const q = filters.search;
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (filters.status !== undefined) where.status = filters.status;
  if (filters.teamId !== undefined) where.memberships = { some: { teamId: filters.teamId } };
  const rows = await tenantPrisma.user.findMany({
    where,
    include: {
      role: { select: { name: true } },
      memberships: { select: { team: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
  return rows.map(presentUser);
}

async function getUser({ tenantPrisma, userId }) {
  const row = await tenantPrisma.user.findUnique({
    where: { id: userId },
    include: {
      role: { select: { name: true } },
      memberships: { select: { team: { select: { id: true, name: true } } } },
    },
  });
  if (!row) throw notFoundError('User not found');
  return presentUser(row);
}

async function createUser({ tenantPrisma, organizationId, input }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      await resolveRef({
        tx,
        organizationId,
        model: 'role',
        id: input.roleId,
        notFound: 'Role not found',
        crossTenant: 'Cannot assign a role from another organization',
        softDeleted: 'Cannot assign a deleted role',
      });
      try {
        const created = await tx.user.create({
          data: {
            name: input.name,
            email: input.email,
            passwordHash: await hashPassword(input.password),
            roleId: input.roleId,
            status: 'ACTIVE',
          },
          include: { role: { select: { name: true } }, memberships: { select: { team: true } } },
        });
        return presentUser(created);
      } catch (err) {
        if (err.code === 'P2002') throw conflictError('Email already in use in this organization');
        throw err;
      }
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

module.exports = { listUsers, getUser, createUser };
