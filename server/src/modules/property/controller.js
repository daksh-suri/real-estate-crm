const {
  validate,
  unitAvailabilities,
  createProjectSchema,
  updateProjectSchema,
  projectIdParamSchema,
  listQuerySchema,
  createUnitSchema,
  updateUnitSchema,
  unitIdParamSchema,
} = require('./validation');
const service = require('./service');

function orgId(req) {
  return req.auth.organizationId;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

async function createProject(req, res, next) {
  try {
    const data = validate(createProjectSchema, req.body);
    const project = await service.createProject({ tenantPrisma: req.tenantPrisma, data });
    return res.status(201).json(project);
  } catch (err) {
    return next(err);
  }
}

async function listProjects(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const projects = await service.listProjects({
      tenantPrisma: req.tenantPrisma,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(projects);
  } catch (err) {
    return next(err);
  }
}

async function getProject(req, res, next) {
  try {
    const { projectId } = validate(projectIdParamSchema, req.params);
    const project = await service.getProject({ tenantPrisma: req.tenantPrisma, organizationId: orgId(req), projectId });
    return res.json(project);
  } catch (err) {
    return next(err);
  }
}

async function updateProject(req, res, next) {
  try {
    const { projectId } = validate(projectIdParamSchema, req.params);
    const data = validate(updateProjectSchema, req.body);
    const updated = await service.updateProject({
      tenantPrisma: req.tenantPrisma,
      organizationId: orgId(req),
      projectId,
      data,
    });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

async function deleteProject(req, res, next) {
  try {
    const { projectId } = validate(projectIdParamSchema, req.params);
    const deleted = await service.deleteProject({ tenantPrisma: req.tenantPrisma, organizationId: orgId(req), projectId });
    return res.json(deleted);
  } catch (err) {
    return next(err);
  }
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

async function createUnit(req, res, next) {
  try {
    const { projectId } = validate(projectIdParamSchema, req.params);
    const data = validate(createUnitSchema, req.body);
    const unit = await service.createUnit({
      tenantPrisma: req.tenantPrisma,
      organizationId: orgId(req),
      projectId,
      data,
    });
    return res.status(201).json(unit);
  } catch (err) {
    return next(err);
  }
}

async function listUnitsForProject(req, res, next) {
  try {
    const { projectId } = validate(projectIdParamSchema, req.params);
    const units = await service.listUnitsForProject({
      tenantPrisma: req.tenantPrisma,
      organizationId: orgId(req),
      projectId,
    });
    return res.json(units);
  } catch (err) {
    return next(err);
  }
}

async function listUnits(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const availabilityStatus = req.query.availabilityStatus;
    if (availabilityStatus !== undefined && !unitAvailabilities.includes(availabilityStatus)) {
      const err = new Error('Invalid availabilityStatus filter');
      err.statusCode = 400;
      throw err;
    }
    const units = await service.listAllUnits({
      tenantPrisma: req.tenantPrisma,
      search: query.search,
      availabilityStatus,
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(units);
  } catch (err) {
    return next(err);
  }
}

async function getUnit(req, res, next) {
  try {
    const { unitId } = validate(unitIdParamSchema, req.params);
    const unit = await service.getUnit({ tenantPrisma: req.tenantPrisma, unitId });
    return res.json(unit);
  } catch (err) {
    return next(err);
  }
}

async function updateUnit(req, res, next) {
  try {
    const { unitId } = validate(unitIdParamSchema, req.params);
    // Zod strips unknown keys, so enforce immutable/system-managed fields
    // against the raw body for a precise error.
    if (req.body.projectId !== undefined) {
      const err = new Error('Unit cannot be moved to another project');
      err.statusCode = 400;
      throw err;
    }
    if (req.body.availabilityStatus !== undefined) {
      const err = new Error('availabilityStatus cannot be edited directly; it is managed by reservation/booking flows');
      err.statusCode = 400;
      throw err;
    }
    const data = validate(updateUnitSchema, req.body);
    const updated = await service.updateUnit({ tenantPrisma: req.tenantPrisma, unitId, data });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

async function deleteUnit(req, res, next) {
  try {
    const { unitId } = validate(unitIdParamSchema, req.params);
    const deleted = await service.deleteUnit({ tenantPrisma: req.tenantPrisma, unitId });
    return res.json(deleted);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  createUnit,
  listUnitsForProject,
  listUnits,
  getUnit,
  updateUnit,
  deleteUnit,
};
