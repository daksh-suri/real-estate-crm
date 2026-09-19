// Campaign — tenant-scoped marketing attribution (Phase 3 #11).
// Optionally linked to a LeadSource in the SAME organization; a campaign with
// no source is allowed (payload carried no recognizable reference — never guessed).

async function assertLeadSource({ tenantPrisma, organizationId, leadSourceId }) {
  if (!leadSourceId) return null;
  const src = await tenantPrisma.leadSource.findUnique({ where: { id: leadSourceId } });
  if (!src) {
    // Tenant reads hide cross-tenant rows; classify so same-org mistakes get
    // a precise error without leaking other tenants' existence.
    const raw = await tenantPrisma._raw.leadSource.findUnique({ where: { id: leadSourceId } });
    if (raw && raw.organizationId !== organizationId) {
      const err = new Error('Cannot attach campaign to a lead source from another organization');
      err.statusCode = 403;
      throw err;
    }
    const err = new Error('LeadSource not found');
    err.statusCode = 404;
    throw err;
  }
  return src;
}

async function createCampaign({ tenantPrisma, organizationId, data }) {
  const name = data.name?.trim();
  if (!name) {
    const err = new Error('Campaign name is required');
    err.statusCode = 400;
    throw err;
  }
  await assertLeadSource({ tenantPrisma, organizationId, leadSourceId: data.leadSourceId });
  try {
    return await tenantPrisma.campaign.create({
      data: {
        name,
        leadSourceId: data.leadSourceId || null,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
      },
    });
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('Campaign name already exists in this organization');
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
}

async function getCampaign({ tenantPrisma, campaignId }) {
  const row = await tenantPrisma.campaign.findUnique({ where: { id: campaignId } });
  if (!row) {
    const err = new Error('Campaign not found');
    err.statusCode = 404;
    throw err;
  }
  return row;
}

async function listCampaigns({ tenantPrisma, search, limit = 20, offset = 0 }) {
  const where = {};
  if (search) {
    where.name = { contains: search.trim(), mode: 'insensitive' };
  }
  return tenantPrisma.campaign.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
}

async function updateCampaign({ tenantPrisma, organizationId, campaignId, data }) {
  await getCampaign({ tenantPrisma, campaignId });
  if (data.leadSourceId !== undefined && data.leadSourceId !== null) {
    await assertLeadSource({ tenantPrisma, organizationId, leadSourceId: data.leadSourceId });
  }
  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.leadSourceId !== undefined) updateData.leadSourceId = data.leadSourceId;
  if (data.startDate !== undefined) updateData.startDate = data.startDate;
  if (data.endDate !== undefined) updateData.endDate = data.endDate;
  if (Object.keys(updateData).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }
  try {
    return await tenantPrisma.campaign.update({ where: { id: campaignId }, data: updateData });
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('Campaign name already exists in this organization');
      e.statusCode = 409;
      throw e;
    }
    if (err.code === 'P2025') {
      const e = new Error('Campaign not found');
      e.statusCode = 404;
      throw e;
    }
    throw err;
  }
}

async function deleteCampaign({ tenantPrisma, campaignId }) {
  await getCampaign({ tenantPrisma, campaignId });
  try {
    return await tenantPrisma.campaign.delete({ where: { id: campaignId } });
  } catch (err) {
    if (err.code === 'P2025') {
      const e = new Error('Campaign not found');
      e.statusCode = 404;
      throw e;
    }
    throw err;
  }
}

module.exports = {
  assertLeadSource,
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
  deleteCampaign,
};
