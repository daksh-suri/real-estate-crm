const {
  validate,
  createPlanSchema,
  planIdParamSchema,
  obligationIdParamSchema,
  recordIdParamSchema,
  listQuerySchema,
  webhookSchema,
} = require('./validation');
const service = require('./service');
const { prisma } = require('../../lib/prisma');
const { IdempotentReplay, idempotencyKeyFrom, assertIdempotencyKey } = require('../../lib/idempotency');

async function createPlan(req, res, next) {
  try {
    const input = validate(createPlanSchema, req.body);
    const key = idempotencyKeyFrom(req);
    assertIdempotencyKey(key);
    const result = await service.createPlan({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      idempotencyKey: key,
      input,
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof IdempotentReplay) {
      return res.status(200).json(err.snapshot);
    }
    return next(err);
  }
}

async function listPlans(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const rows = await service.listPlans({
      tenantPrisma: req.tenantPrisma,
      filters: { dealId: query.dealId },
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
}

async function getPlan(req, res, next) {
  try {
    const { planId } = validate(planIdParamSchema, req.params);
    const row = await service.getPlan({ tenantPrisma: req.tenantPrisma, planId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function getObligation(req, res, next) {
  try {
    const { obligationId } = validate(obligationIdParamSchema, req.params);
    const row = await service.getObligation({ tenantPrisma: req.tenantPrisma, obligationId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function getRecord(req, res, next) {
  try {
    const { recordId } = validate(recordIdParamSchema, req.params);
    const row = await service.getRecord({ tenantPrisma: req.tenantPrisma, recordId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

// External boundary: no authenticate — the tenant comes from the obligation
// row, and the gateway eventId is the dedup identity (see DEC-029).
async function webhook(req, res, next) {
  try {
    const input = validate(webhookSchema, req.body);
    const result = await service.processWebhook({ rawPrisma: prisma, input });
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof IdempotentReplay) {
      return res.status(200).json(err.snapshot);
    }
    return next(err);
  }
}

module.exports = { createPlan, listPlans, getPlan, getObligation, getRecord, webhook };
