// Property hierarchy: Organization → Project → Unit.
// All queries go through tenantPrisma — tenant context comes from
// authentication, never from request payloads.

async function resolveProject({ tenantPrisma, organizationId, projectId, action }) {
  const project = await tenantPrisma.project.findUnique({ where: { id: projectId } });
  if (project) return project;
  // Cross-tenant rows always 404 (hide existence) per Checkpoints 1–5
  // convention. Same-org soft-deleted rows 404 on reads, 400 on writes so
  // callers know why the mutation was rejected.
  const isRead = action === 'read' || action === 'list units for';
  if (isRead) {
    const err = new Error('Project not found');
    err.statusCode = 404;
    throw err;
  }
  const raw = await tenantPrisma._raw.project.findUnique({ where: { id: projectId } });
  if (raw && raw.organizationId === organizationId && raw.deletedAt) {
    const err = new Error(`Cannot ${action} a soft-deleted project`);
    err.statusCode = 400;
    throw err;
  }
  const err = new Error('Project not found');
  err.statusCode = 404;
  throw err;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

async function createProject({ tenantPrisma, data }) {
  const name = data.name.trim();
  if (!name) {
    const err = new Error('Project name is required');
    err.statusCode = 400;
    throw err;
  }
  try {
    const project = await tenantPrisma.project.create({
      data: {
        name,
        location: data.location !== undefined ? data.location : null,
        status: data.status || 'ACTIVE',
      },
    });
    return project;
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('Project name already exists in this organization');
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
}

async function listProjects({ tenantPrisma, search, limit = 20, offset = 0 }) {
  const where = {};
  if (search) {
    const term = search.trim();
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { location: { contains: term, mode: 'insensitive' } },
    ];
  }
  const projects = await tenantPrisma.project.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
  return projects;
}

async function getProject({ tenantPrisma, organizationId, projectId }) {
  const project = await resolveProject({ tenantPrisma, organizationId, projectId, action: 'read' });
  return project;
}

async function updateProject({ tenantPrisma, organizationId, projectId, data }) {
  await resolveProject({ tenantPrisma, organizationId, projectId, action: 'update' });

  const updateData = {};
  if (data.name !== undefined) updateData.name = data.name.trim();
  if (data.location !== undefined) updateData.location = data.location;
  if (data.status !== undefined) updateData.status = data.status;

  if (Object.keys(updateData).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }

  try {
    const updated = await tenantPrisma.project.update({ where: { id: projectId }, data: updateData });
    return updated;
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('Project name already exists in this organization');
      e.statusCode = 409;
      throw e;
    }
    if (err.code === 'P2025') {
      const e = new Error('Project not found');
      e.statusCode = 404;
      throw e;
    }
    throw err;
  }
}

async function deleteProject({ tenantPrisma, organizationId, projectId }) {
  await resolveProject({ tenantPrisma, organizationId, projectId, action: 'delete' });
  // Soft delete only. Units keep their projectId — history needed by future
  // bookings/reservations is never physically destroyed (Project→Unit FK is
  // Restrict for the same reason).
  const deleted = await tenantPrisma.project.update({
    where: { id: projectId },
    data: { deletedAt: new Date() },
  });
  return deleted;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

async function createUnit({ tenantPrisma, organizationId, projectId, data }) {
  const project = await resolveProject({ tenantPrisma, organizationId, projectId, action: 'create unit under' });

  const identifier = data.identifier.trim();
  if (!identifier) {
    const err = new Error('Unit identifier is required');
    err.statusCode = 400;
    throw err;
  }

  try {
    const unit = await tenantPrisma.unit.create({
      data: {
        projectId: project.id,
        identifier,
        totalCost: data.totalCost != null ? data.totalCost : null,
        availabilityStatus: data.availabilityStatus || 'AVAILABLE',
      },
    });
    return unit;
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('Unit identifier already exists in this project');
      e.statusCode = 409;
      throw e;
    }
    throw err;
  }
}

async function listUnitsForProject({ tenantPrisma, organizationId, projectId }) {
  await resolveProject({ tenantPrisma, organizationId, projectId, action: 'list units for' });
  const units = await tenantPrisma.unit.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
  return units;
}

async function listAllUnits({ tenantPrisma, search, availabilityStatus, limit = 20, offset = 0 }) {
  const where = {};
  if (availabilityStatus) where.availabilityStatus = availabilityStatus;
  if (search) {
    const term = search.trim();
    where.identifier = { contains: term, mode: 'insensitive' };
  }
  const units = await tenantPrisma.unit.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
  return units;
}

async function getUnit({ tenantPrisma, unitId }) {
  const unit = await tenantPrisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) {
    const err = new Error('Unit not found');
    err.statusCode = 404;
    throw err;
  }
  return unit;
}

async function updateUnit({ tenantPrisma, unitId, data }) {
  const existing = await tenantPrisma.unit.findUnique({ where: { id: unitId } });
  if (!existing) {
    const err = new Error('Unit not found');
    err.statusCode = 404;
    throw err;
  }

  // Unit.projectId is immutable: moving inventory between projects would break
  // identifier uniqueness scope and future reservation audit trails.
  if (data.projectId !== undefined && data.projectId !== existing.projectId) {
    const err = new Error('Unit cannot be moved to another project');
    err.statusCode = 400;
    throw err;
  }
  // availabilityStatus transitions belong exclusively to Reservation/Hold/
  // Booking flows (later checkpoints) — never edited directly.
  if (data.availabilityStatus !== undefined && data.availabilityStatus !== existing.availabilityStatus) {
    const err = new Error('availabilityStatus cannot be edited directly; it is managed by reservation/booking flows');
    err.statusCode = 400;
    throw err;
  }

  const updateData = {};
  if (data.identifier !== undefined) updateData.identifier = data.identifier.trim();
  if (data.totalCost !== undefined) updateData.totalCost = data.totalCost;

  if (Object.keys(updateData).length === 0) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }

  try {
    const updated = await tenantPrisma.unit.update({ where: { id: unitId }, data: updateData });
    return updated;
  } catch (err) {
    if (err.code === 'P2002') {
      const e = new Error('Unit identifier already exists in this project');
      e.statusCode = 409;
      throw e;
    }
    if (err.code === 'P2025') {
      const e = new Error('Unit not found');
      e.statusCode = 404;
      throw e;
    }
    throw err;
  }
}

async function deleteUnit({ tenantPrisma, unitId }) {
  const existing = await tenantPrisma.unit.findUnique({ where: { id: unitId } });
  if (!existing) {
    const err = new Error('Unit not found');
    err.statusCode = 404;
    throw err;
  }
  // Soft delete preserves history for future reservations/bookings.
  const deleted = await tenantPrisma.unit.update({
    where: { id: unitId },
    data: { deletedAt: new Date() },
  });
  return deleted;
}

module.exports = {
  resolveProject,
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  createUnit,
  listUnitsForProject,
  listAllUnits,
  getUnit,
  updateUnit,
  deleteUnit,
};
