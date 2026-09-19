// LeadSource — tenant-scoped intake attribution config (Phase 3 #11).
// First-class entity (not an enum) so admins can add portal/source names.
// Deletion is a hard delete; referencing Leads/Enquiries/Campaigns keep
// history via SetNull FKs.

async function createLeadSource({ tenantPrisma, data }) {
  const name = data.name?.trim();
  if (!name) {
    const err = new Error('LeadSource name is required');
    err.statusCode = 400;
    throw err;
  }
  try {
    return await tenantPrisma.leadSource.create({
      data: { name, type: data.type !== undefined ? data.type : null },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('LeadSource name already exists in this organization');
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
}

async function getLeadSource({ tenantPrisma, leadSourceId }) {
  const src = await tenantPrisma.leadSource.findUnique({ where: { id: leadSourceId } });
  if (!src) {
    const err = new Error('LeadSource not found');
    err.statusCode = 404;
    throw err;
  }
  return src;
}

async function listLeadSources({ tenantPrisma, search, limit = 20, offset = 0 }) {
  const where = {};
  if (search) {
    const term = search.trim();
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { type: { contains: term, mode: 'insensitive' } },
    ];
  }
  return tenantPrisma.leadSource.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
}

async function updateLeadSource({ tenantPrisma, leadSourceId, data }) {
  await getLeadSource({ tenantPrisma, leadSourceId });
  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.type !== undefined) updateData.type = data.type;
  if (Object.keys(updateData).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }
  try {
    return await tenantPrisma.leadSource.update({ where: { id: leadSourceId }, data: updateData });
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('LeadSource name already exists in this organization');
      e.statusCode = 409;
      throw e;
    }
    if (err.code === 'P2025') {
      const e = new Error('LeadSource not found');
      e.statusCode = 404;
      throw e;
    }
    throw err;
  }
}

async function deleteLeadSource({ tenantPrisma, leadSourceId }) {
  await getLeadSource({ tenantPrisma, leadSourceId });
  try {
    return await tenantPrisma.leadSource.delete({ where: { id: leadSourceId } });
  } catch (err) {
    if (err.code === 'P2025') {
      const e = new Error('LeadSource not found');
      e.statusCode = 404;
      throw e;
    }
    throw err;
  }
}

module.exports = {
  createLeadSource,
  getLeadSource,
  listLeadSources,
  updateLeadSource,
  deleteLeadSource,
};
