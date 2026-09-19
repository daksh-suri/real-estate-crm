const {
  validate,
  createLeadSourceSchema,
  updateLeadSourceSchema,
  leadSourceIdParamSchema,
  listQuerySchema,
} = require('./validation');
const service = require('./service');

async function create(req, res, next) {
  try {
    const data = validate(createLeadSourceSchema, req.body);
    const src = await service.createLeadSource({ tenantPrisma: req.tenantPrisma, data });
    return res.status(201).json(src);
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const rows = await service.listLeadSources({
      tenantPrisma: req.tenantPrisma,
      search: query.search,
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { leadSourceId } = validate(leadSourceIdParamSchema, req.params);
    const src = await service.getLeadSource({ tenantPrisma: req.tenantPrisma, leadSourceId });
    return res.json(src);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const { leadSourceId } = validate(leadSourceIdParamSchema, req.params);
    const data = validate(updateLeadSourceSchema, req.body);
    const updated = await service.updateLeadSource({ tenantPrisma: req.tenantPrisma, leadSourceId, data });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { leadSourceId } = validate(leadSourceIdParamSchema, req.params);
    const deleted = await service.deleteLeadSource({ tenantPrisma: req.tenantPrisma, leadSourceId });
    return res.json(deleted);
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getOne, update, remove };
