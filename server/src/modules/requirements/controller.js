const { validate, createRequirementSchema, updateRequirementSchema, requirementIdParamSchema, contactIdParamSchema } = require('./validation');
const service = require('./service');

async function create(req, res, next) {
  try {
    const data = validate(createRequirementSchema, req.body);
    const requirement = await service.createRequirement({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      data,
    });
    return res.status(201).json(requirement);
  } catch (err) {
    return next(err);
  }
}

async function createForContact(req, res, next) {
  try {
    const { contactId } = validate(contactIdParamSchema, req.params);
    const body = validate(createRequirementSchema, { ...req.body, contactId });
    // Ensure contactId from params is used, not body
    const requirement = await service.createRequirement({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      data: { ...body, contactId },
    });
    return res.status(201).json(requirement);
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { requirementId } = validate(requirementIdParamSchema, req.params);
    const reqDoc = await service.getRequirement({ tenantPrisma: req.tenantPrisma, requirementId });
    return res.json(reqDoc);
  } catch (err) {
    return next(err);
  }
}

async function listForContact(req, res, next) {
  try {
    const { contactId } = validate(contactIdParamSchema, req.params);
    const list = await service.listRequirementsForContact({ tenantPrisma: req.tenantPrisma, contactId });
    return res.json(list);
  } catch (err) {
    return next(err);
  }
}

async function listAll(req, res, next) {
  try {
    const list = await service.listAllRequirements({ tenantPrisma: req.tenantPrisma });
    return res.json(list);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const { requirementId } = validate(requirementIdParamSchema, req.params);
    const data = validate(updateRequirementSchema, req.body);
    const updated = await service.updateRequirement({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      requirementId,
      data,
    });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { requirementId } = validate(requirementIdParamSchema, req.params);
    const deleted = await service.deleteRequirement({ tenantPrisma: req.tenantPrisma, requirementId });
    return res.json(deleted);
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, createForContact, getOne, listForContact, listAll, update, remove };
