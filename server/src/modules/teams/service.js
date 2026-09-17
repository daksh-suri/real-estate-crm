// Use tenantPrisma for all tenant-scoped queries

async function createTeam({ tenantPrisma, organizationId, name }) {
  if (!organizationId) {
    const err = new Error('Organization context required');
    err.statusCode = 400;
    throw err;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    const err = new Error('Team name required');
    err.statusCode = 400;
    throw err;
  }
  try {
    const team = await tenantPrisma.team.create({ data: { name: trimmed } });
    return team;
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('Team name already exists in this organization');
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
}

async function listTeams({ tenantPrisma }) {
  const teams = await tenantPrisma.team.findMany({ orderBy: { createdAt: 'asc' } });
  return teams;
}

async function getTeam({ tenantPrisma, teamId }) {
  const team = await tenantPrisma.team.findUnique({ where: { id: teamId } });
  if (!team) {
    const err = new Error('Team not found');
    err.statusCode = 404;
    throw err;
  }
  return team;
}

async function updateTeam({ tenantPrisma, teamId, data }) {
  const existing = await tenantPrisma.team.findUnique({ where: { id: teamId } });
  if (!existing) {
    const err = new Error('Team not found');
    err.statusCode = 404;
    throw err;
  }
  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name.trim();

  if (Object.keys(updateData).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }

  try {
    const updated = await tenantPrisma.team.update({ where: { id: teamId }, data: updateData });
    return updated;
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('Team name already exists in this organization');
      e.statusCode = 409;
      throw e;
    }
    if (err.code === 'P2025') {
      const e = new Error('Team not found');
      e.statusCode = 404;
      throw e;
    }
    throw err;
  }
}

async function deleteTeam({ tenantPrisma, teamId }) {
  const existing = await tenantPrisma.team.findUnique({ where: { id: teamId } });
  if (!existing) {
    const err = new Error('Team not found');
    err.statusCode = 404;
    throw err;
  }
  // Soft delete preserve historical membership
  const archived = await tenantPrisma.team.update({ where: { id: teamId }, data: { deletedAt: new Date() } });
  return archived;
}

async function addMember({ tenantPrisma, organizationId: _organizationId, teamId, userId }) {
  // Verify team belongs to org via tenantPrisma
  const team = await tenantPrisma.team.findUnique({ where: { id: teamId } });
  if (!team) {
    const err = new Error('Team not found');
    err.statusCode = 404;
    throw err;
  }

  // Verify user belongs to same org and is active
  const user = await tenantPrisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const err = new Error('User not found in this organization');
    err.statusCode = 404;
    throw err;
  }
  // Check user status — deactivated/deleted cannot be added
  if (user.status === 'DEACTIVATED') {
    const err = new Error('Deactivated user cannot be added to team');
    err.statusCode = 403;
    throw err;
  }
  if (user.deletedAt) {
    const err = new Error('Deleted user cannot be added to team');
    err.statusCode = 403;
    throw err;
  }

  // Use transaction to handle race on duplicate creation with DB unique as final guard
  // We rely on DB unique (userId, teamId) to prevent duplicates; app check is best-effort
  try {
    // Use raw prisma for membership creation with explicit organizationId to ensure tenant
    // But tenantPrisma already injects organizationId, so we can use it
    // We also need to ensure cross-tenant check is done — tenantPrisma's assert will handle, but we already checked
    const membership = await tenantPrisma.teamMembership.create({
      data: { userId, teamId },
    });
    return membership;
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('User is already a member of this team');
      e.statusCode = 409;
      throw e;
    }
    // Cross-tenant errors from tenant wrapper will have status 403
    throw err;
  }
}

async function removeMember({ tenantPrisma, teamId, userId }) {
  const team = await tenantPrisma.team.findUnique({ where: { id: teamId } });
  if (!team) {
    const err = new Error('Team not found');
    err.statusCode = 404;
    throw err;
  }
  // Find membership via tenantPrisma (ensures same org)
  const membership = await tenantPrisma.teamMembership.findFirst({ where: { teamId, userId } });
  if (!membership) {
    const err = new Error('Membership not found');
    err.statusCode = 404;
    throw err;
  }
  await tenantPrisma.teamMembership.delete({ where: { id: membership.id } });
  return { removed: true };
}

async function listTeamMembers({ tenantPrisma, teamId }) {
  const team = await tenantPrisma.team.findUnique({ where: { id: teamId } });
  if (!team) {
    const err = new Error('Team not found');
    err.statusCode = 404;
    throw err;
  }
  const memberships = await tenantPrisma.teamMembership.findMany({
    where: { teamId },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });
  // Strip passwordHash from users
  const members = memberships.map((m) => {
    const { passwordHash, ...safeUser } = m.user;
    void passwordHash;
    return { membershipId: m.id, joinedAt: m.createdAt, user: safeUser };
  });
  return members;
}

async function listUserTeams({ tenantPrisma, userId }) {
  // Verify user belongs to org via tenantPrisma
  const user = await tenantPrisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const err = new Error('User not found in this organization');
    err.statusCode = 404;
    throw err;
  }
  const memberships = await tenantPrisma.teamMembership.findMany({
    where: { userId },
    include: { team: true },
    orderBy: { createdAt: 'asc' },
  });
  // Filter out soft-deleted teams (tenantPrisma.team's find handles, but membership's team may be soft-deleted and not included via tenant filter? We already filtered team via tenant, but membership's team include will still return soft-deleted? Our tenant wrapper for team filters deletedAt null, but here we include team via membership, need to filter manually)
  const teams = memberships
    .map((m) => m.team)
    .filter((t) => t && !t.deletedAt)
    .map((t) => t);
  return teams;
}

module.exports = {
  createTeam,
  listTeams,
  getTeam,
  updateTeam,
  deleteTeam,
  addMember,
  removeMember,
  listTeamMembers,
  listUserTeams,
};
