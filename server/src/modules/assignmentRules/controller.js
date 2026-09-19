const {
  validate,
  createAssignmentRuleSchema,
  updateAssignmentRuleSchema,
  assignmentRuleIdParamSchema,
  listQuerySchema,
} = require('./validation');
const service = require('./service');

async function create(req, res, next) {
  try {
    const data = validate(createAssignmentRuleSchema, req.body);
    const row = await service.createAssignmentRule({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      data,
    });
    return res.status(201).json(row);
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const rows = await service.listAssignmentRules({
      tenantPrisma: req.tenantPrisma,
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
    const { assignmentRuleId } = validate(assignmentRuleIdParamSchema, req.params);
    const row = await service.getAssignmentRule({ tenantPrisma: req.tenantPrisma, assignmentRuleId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const { assignmentRuleId } = validate(assignmentRuleIdParamSchema, req.params);
    const data = validate(updateAssignmentRuleSchema, req.body);
    const updated = await service.updateAssignmentRule({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      assignmentRuleId,
      data,
    });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { assignmentRuleId } = validate(assignmentRuleIdParamSchema, req.params);
    const deleted = await service.deleteAssignmentRule({ tenantPrisma: req.tenantPrisma, assignmentRuleId });
    return res.json(deleted);
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getOne, update, remove };
