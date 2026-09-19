const {
  validate,
  createDealSchema,
  updateDealSchema,
  transitionSchema,
  dealIdParamSchema,
  listQuerySchema,
} = require('./validation');
const service = require('./service');

// Relationship fields are immutable after creation: contactId/leadId come
// from the source Lead, stage/lostReason move via the transition endpoint,
// organizationId is never client-controlled. Reject them against the raw body
// (zod strips unknowns) so the client gets a precise error, mirroring the
// Unit.projectId / Lead.assignedAgentId pattern.
const IMMUTABLE_UPDATE_FIELDS = ['stage', 'lostReason', 'contactId', 'leadId', 'organizationId', 'originEnquiryId'];

async function create(req, res, next) {
  try {
    const data = validate(createDealSchema, req.body);
    const deal = await service.createDeal({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      actorId: req.auth.userId,
      leadId: data.leadId,
      unitId: data.unitId,
    });
    return res.status(201).json(deal);
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const deals = await service.listDeals({
      tenantPrisma: req.tenantPrisma,
      filters: {
        stage: query.stage,
        contactId: query.contactId,
        leadId: query.leadId,
        unitId: query.unitId,
      },
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(deals);
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { dealId } = validate(dealIdParamSchema, req.params);
    const deal = await service.getDeal({ tenantPrisma: req.tenantPrisma, dealId });
    return res.json(deal);
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const { dealId } = validate(dealIdParamSchema, req.params);
    const blocked = IMMUTABLE_UPDATE_FIELDS.find((field) => req.body[field] !== undefined);
    if (blocked) {
      const err = new Error(
        `Deal ${blocked} cannot be changed via generic update` +
          (blocked === 'stage' || blocked === 'lostReason'
            ? '; use POST /deals/:dealId/stage-transition'
            : '')
      );
      err.statusCode = 400;
      throw err;
    }
    const data = validate(updateDealSchema, req.body);
    const updated = await service.updateDeal({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      dealId,
      data,
    });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { dealId } = validate(dealIdParamSchema, req.params);
    const deleted = await service.deleteDeal({ tenantPrisma: req.tenantPrisma, dealId });
    return res.json(deleted);
  } catch (err) {
    return next(err);
  }
}

async function transition(req, res, next) {
  try {
    const { dealId } = validate(dealIdParamSchema, req.params);
    const data = validate(transitionSchema, req.body);
    const updated = await service.transitionDeal({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      actorId: req.auth.userId,
      dealId,
      stage: data.stage,
      lostReason: data.lostReason,
      fromStage: data.fromStage,
    });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getOne, update, remove, transition };
