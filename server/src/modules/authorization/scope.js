// Scope resolution helpers for TEAM / PROJECT / ORGANIZATION.
// At Checkpoint 3, Project does not exist, so PROJECT scope cannot be evaluated
// against a real resource — it returns requiresContext.

const { prisma } = require('../../lib/prisma');

const SCOPE_HIERARCHY = ['OWN', 'TEAM', 'PROJECT', 'ORGANIZATION'];

// Returns list of teamIds the user belongs to (many-to-many)
async function getUserTeamIds(userId, organizationId) {
  const memberships = await prisma.teamMembership.findMany({
    where: { userId, organizationId },
    select: { teamId: true },
  });
  return memberships.map((m) => m.teamId);
}

// Check TEAM scope: does user belong to any team that is associated with resource?
// For now, since no business resources exist, this helper just verifies membership.
async function isTeamScopeAllowed(user) {
  const teamIds = await getUserTeamIds(user.id, user.organizationId);
  return teamIds.length > 0;
}

// PROJECT scope: no Project model at checkpoint 3 — always requires context
function isProjectScopeAllowed() {
  // Later checkpoints will provide projectId and check project membership
  return { allowed: false, reason: 'PROJECT scope requires project context (Project model not yet implemented)' };
}

// OWN scope: resource is owned/assigned to user — caller must provide ownerId to compare
function isOwnScopeAllowed(user, ownerId) {
  if (!ownerId) return { allowed: false, reason: 'OWN scope requires ownerId' };
  return { allowed: user.id === ownerId, reason: user.id === ownerId ? null : 'Not owner' };
}

// ORGANIZATION scope: always allowed within authenticated org if permission exists
function isOrganizationScopeAllowed(user, resourceOrganizationId) {
  if (!resourceOrganizationId) return true; // if no resource org, tenant check via auth org suffices
  return user.organizationId === resourceOrganizationId;
}

module.exports = {
  getUserTeamIds,
  isTeamScopeAllowed,
  isProjectScopeAllowed,
  isOwnScopeAllowed,
  isOrganizationScopeAllowed,
  SCOPE_HIERARCHY,
};
