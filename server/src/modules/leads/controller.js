const { validate, updateLeadSchema, reassignSchema, leadIdParamSchema, listQuerySchema } = require('./validation');
const service = require('./service');

function orgId(req) {
  return req.auth.organizationId;
}

async function list(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const rows = await service.listLeads({
      tenantPrisma: req.tenantPrisma,
      filters: {
        status: query.status,
        contactId: query.contactId,
        projectId: query.projectId,
        assignedAgentId: query.assignedAgentId,
        leadSourceId: query.leadSourceId,
        campaignId: query.campaignId,
      },
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
    const { leadId } = validate(leadIdParamSchema, req.params);
    const lead = await service.getLead({ tenantPrisma: req.tenantPrisma, leadId });
    return res.json(lead);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const { leadId } = validate(leadIdParamSchema, req.params);
    // Assignment changes go through the reassignment endpoint so the target
    // agent is validated and the source is recorded as MANUAL.
    if (req.body.assignedAgentId !== undefined) {
      const err = new Error('Use POST /leads/:leadId/reassign to change assignment');
      err.statusCode = 400;
      throw err;
    }
    const data = validate(updateLeadSchema, req.body);
    const updated = await service.updateLead({
      tenantPrisma: req.tenantPrisma,
      organizationId: orgId(req),
      leadId,
      data,
    });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { leadId } = validate(leadIdParamSchema, req.params);
    const deleted = await service.deleteLead({ tenantPrisma: req.tenantPrisma, leadId });
    return res.json(deleted);
  } catch (err) {
    return next(err);
  }
}

async function reassign(req, res, next) {
  try {
    const { leadId } = validate(leadIdParamSchema, req.params);
    const { assignedAgentId } = validate(reassignSchema, req.body);
    const updated = await service.reassignLead({
      tenantPrisma: req.tenantPrisma,
      organizationId: orgId(req),
      leadId,
      assignedAgentId,
    });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

module.exports = { list, getOne, update, remove, reassign };
