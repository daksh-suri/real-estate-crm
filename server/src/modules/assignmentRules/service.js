// AssignmentRule — purpose-built Lead assignment config (Phase 3 #10).
// Checkpoint 7 ships ROUND_ROBIN (+ manual reassignment) only. The table keeps
// type/order/config/active so PROJECT_AFFINITY/TERRITORY arrive as new row
// types + new small functions, never as a generic rule interpreter.
//
// config carries type-specific PARAMETERS only, never logic:
//   ROUND_ROBIN: { teamId } (required) — rotate among ACTIVE team members.

const { resolveRef } = require('../../lib/refs');

async function assertTeam({ tenantPrisma, organizationId, teamId }) {
  return resolveRef({
    tx: tenantPrisma, organizationId, model: 'team', id: teamId,
    notFound: 'Team not found',
    crossTenant: 'Cannot use a team from another organization in an assignment rule',
    softDeleted: 'Cannot use a soft-deleted team in an assignment rule',
  });
}

function assertConfigForType(type, config) {
  if (type === 'ROUND_ROBIN') {
    if (!config || !config.teamId) {
      const err = new Error('ROUND_ROBIN assignment rule requires config.teamId');
      err.statusCode = 400;
      throw err;
    }
  }
}

async function createAssignmentRule({ tenantPrisma, organizationId, data }) {
  const config = data.config || {};
  assertConfigForType(data.type, config);
  if (config.teamId) {
    await assertTeam({ tenantPrisma, organizationId, teamId: config.teamId });
  }
  return tenantPrisma.assignmentRule.create({
    data: {
      type: data.type,
      order: data.order !== undefined ? data.order : 0,
      config,
      active: data.active !== undefined ? data.active : true,
    },
  });
}

async function getAssignmentRule({ tenantPrisma, assignmentRuleId }) {
  const row = await tenantPrisma.assignmentRule.findUnique({ where: { id: assignmentRuleId } });
  if (!row) {
    const err = new Error('AssignmentRule not found');
    err.statusCode = 404;
    throw err;
  }
  return row;
}

async function listAssignmentRules({ tenantPrisma, limit = 50, offset = 0 }) {
  return tenantPrisma.assignmentRule.findMany({
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    take: Math.min(limit, 100),
    skip: offset,
  });
}

async function updateAssignmentRule({ tenantPrisma, organizationId, assignmentRuleId, data }) {
  const existing = await getAssignmentRule({ tenantPrisma, assignmentRuleId });
  const nextType = data.type !== undefined ? data.type : existing.type;
  const nextConfig = data.config !== undefined ? data.config : existing.config;
  assertConfigForType(nextType, nextConfig);
  if (nextConfig && nextConfig.teamId) {
    await assertTeam({ tenantPrisma, organizationId, teamId: nextConfig.teamId });
  }
  const updateData = {};
  if (data.type !== undefined) updateData.type = data.type;
  if (data.order !== undefined) updateData.order = data.order;
  if (data.config !== undefined) updateData.config = data.config;
  if (data.active !== undefined) updateData.active = data.active;
  if (Object.keys(updateData).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }
  return tenantPrisma.assignmentRule.update({ where: { id: assignmentRuleId }, data: updateData });
}

async function deleteAssignmentRule({ tenantPrisma, assignmentRuleId }) {
  await getAssignmentRule({ tenantPrisma, assignmentRuleId });
  try {
    return await tenantPrisma.assignmentRule.delete({ where: { id: assignmentRuleId } });
  } catch (err) {
    if (err.code === 'P2025') {
      const e = new Error('AssignmentRule not found');
      e.statusCode = 404;
      throw e;
    }
    throw err;
  }
}

module.exports = {
  assertTeam,
  createAssignmentRule,
  getAssignmentRule,
  listAssignmentRules,
  updateAssignmentRule,
  deleteAssignmentRule,
};
