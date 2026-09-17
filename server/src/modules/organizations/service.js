const { prisma } = require('../../lib/prisma');

// Organization is global but tenant-isolated via organizationId
async function getCurrentOrganization(organizationId) {
  if (!organizationId) {
    const err = new Error('Organization context required');
    err.statusCode = 400;
    throw err;
  }
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) {
    const err = new Error('Organization not found');
    err.statusCode = 404;
    throw err;
  }
  return org;
}

async function updateCurrentOrganization(organizationId, data) {
  if (!organizationId) {
    const err = new Error('Organization context required');
    err.statusCode = 400;
    throw err;
  }
  // Only name is mutable in V1; ignore other fields
  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name.trim();

  if (Object.keys(updateData).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }

  const existing = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!existing) {
    const err = new Error('Organization not found');
    err.statusCode = 404;
    throw err;
  }

  // Name uniqueness is global per schema (@@unique on name). In SaaS, org names should be unique globally.
  // If we want to allow same name across tenants, we would need to change schema, but current is global unique.
  // So we handle unique violation.
  try {
    const updated = await prisma.organization.update({ where: { id: organizationId }, data: updateData });
    return updated;
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('Organization name already taken');
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
}

module.exports = { getCurrentOrganization, updateCurrentOrganization };
