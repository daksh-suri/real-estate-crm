// Scope resolution helpers.
const { prisma } = require('../../lib/prisma');

// Returns list of teamIds the user belongs to (many-to-many)
async function getUserTeamIds(userId, organizationId) {
  const memberships = await prisma.teamMembership.findMany({
    where: { userId, organizationId },
    select: { teamId: true },
  });
  return memberships.map((m) => m.teamId);
}

module.exports = {
  getUserTeamIds,
};
