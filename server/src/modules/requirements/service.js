// Phase 3 specifies Requirement.preferredProjectIds as a String[] (not a join
// table). Every ID must reference an existing, non-deleted Project in the same
// organization — cross-tenant or dangling references are rejected.
async function assertPreferredProjects({ tenantPrisma, organizationId, preferredProjectIds }) {
  const ids = [...new Set((preferredProjectIds || []).filter(Boolean))];
  if (ids.length === 0) return;
  const visible = await tenantPrisma.project.findMany({ where: { id: { in: ids } } });
  if (visible.length === ids.length) return;
  const visibleIds = new Set(visible.map((p) => p.id));
  const badIds = ids.filter((id) => !visibleIds.has(id));
  const raw = await tenantPrisma._raw.project.findMany({ where: { id: { in: badIds } } });
  const rawById = new Map(raw.map((p) => [p.id, p]));
  for (const id of badIds) {
    const row = rawById.get(id);
    if (!row) {
      const err = new Error(`Referenced project ${id} not found`);
      err.statusCode = 404;
      throw err;
    }
    if (row.organizationId !== organizationId) {
      const err = new Error(`Cannot associate requirement with project ${id} from another organization`);
      err.statusCode = 403;
      throw err;
    }
    const err = new Error(`Cannot associate requirement with soft-deleted project ${id}`);
    err.statusCode = 400;
    throw err;
  }
}

async function createRequirement({ tenantPrisma, organizationId, data }) {
  const contact = await tenantPrisma.contact.findUnique({ where: { id: data.contactId } });
  if (!contact) {
    const err = new Error('Contact not found in this organization');
    err.statusCode = 404;
    throw err;
  }
  if (contact.deletedAt) {
    const err = new Error('Cannot create requirement for soft-deleted contact');
    err.statusCode = 400;
    throw err;
  }
  await assertPreferredProjects({ tenantPrisma, organizationId, preferredProjectIds: data.preferredProjectIds });

  const createData = {
    contactId: data.contactId,
    unitTypePreference: data.unitTypePreference || null,
    budgetMin: data.budgetMin != null ? data.budgetMin : null,
    budgetMax: data.budgetMax != null ? data.budgetMax : null,
    preferredProjectIds: data.preferredProjectIds || [],
    possessionPreference: data.possessionPreference || null,
    notes: data.notes || null,
    isActive: data.isActive !== undefined ? data.isActive : true,
  };

  const requirement = await tenantPrisma.requirement.create({ data: createData });
  return requirement;
}

async function getRequirement({ tenantPrisma, requirementId }) {
  const req = await tenantPrisma.requirement.findUnique({ where: { id: requirementId } });
  if (!req) {
    const err = new Error('Requirement not found');
    err.statusCode = 404;
    throw err;
  }
  return req;
}

async function listRequirementsForContact({ tenantPrisma, contactId }) {
  const contact = await tenantPrisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) {
    const err = new Error('Contact not found');
    err.statusCode = 404;
    throw err;
  }
  const reqs = await tenantPrisma.requirement.findMany({
    where: { contactId },
    orderBy: { createdAt: 'desc' },
  });
  return reqs;
}

async function listAllRequirements({ tenantPrisma }) {
  const reqs = await tenantPrisma.requirement.findMany({ orderBy: { createdAt: 'desc' } });
  return reqs;
}

async function updateRequirement({ tenantPrisma, organizationId, requirementId, data }) {
  const existing = await tenantPrisma.requirement.findUnique({ where: { id: requirementId } });
  if (!existing) {
    const err = new Error('Requirement not found');
    err.statusCode = 404;
    throw err;
  }
  if (data.preferredProjectIds !== undefined) {
    await assertPreferredProjects({ tenantPrisma, organizationId, preferredProjectIds: data.preferredProjectIds });
  }

  const updateData = {};
  if (data.unitTypePreference !== undefined) updateData.unitTypePreference = data.unitTypePreference;
  if (data.budgetMin !== undefined) updateData.budgetMin = data.budgetMin;
  if (data.budgetMax !== undefined) updateData.budgetMax = data.budgetMax;
  if (data.preferredProjectIds !== undefined) updateData.preferredProjectIds = data.preferredProjectIds;
  if (data.possessionPreference !== undefined) updateData.possessionPreference = data.possessionPreference;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.contactId !== undefined) {
    // Validate new contact belongs to same org and not deleted
    const contact = await tenantPrisma.contact.findUnique({ where: { id: data.contactId } });
    if (!contact) {
      const err = new Error('Contact not found in this organization');
      err.statusCode = 404;
      throw err;
    }
    if (contact.deletedAt) {
      const err = new Error('Cannot attach requirement to soft-deleted contact');
      err.statusCode = 400;
      throw err;
    }
    updateData.contactId = data.contactId;
  }

  if (Object.keys(updateData).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }

  // Validate budget range if both being updated
  const newMin = updateData.budgetMin !== undefined ? updateData.budgetMin : existing.budgetMin;
  const newMax = updateData.budgetMax !== undefined ? updateData.budgetMax : existing.budgetMax;
  if (newMin != null && newMax != null && Number(newMax) < Number(newMin)) {
    const err = new Error('budgetMax must be >= budgetMin');
    err.statusCode = 400;
    throw err;
  }

  const updated = await tenantPrisma.requirement.update({ where: { id: requirementId }, data: updateData });
  return updated;
}

async function deleteRequirement({ tenantPrisma, requirementId }) {
  const existing = await tenantPrisma.requirement.findUnique({ where: { id: requirementId } });
  if (!existing) {
    const err = new Error('Requirement not found');
    err.statusCode = 404;
    throw err;
  }
  // Soft delete preserve history
  const deleted = await tenantPrisma.requirement.update({ where: { id: requirementId }, data: { deletedAt: new Date(), isActive: false } });
  return deleted;
}

module.exports = {
  createRequirement,
  getRequirement,
  listRequirementsForContact,
  listAllRequirements,
  updateRequirement,
  deleteRequirement,
};
