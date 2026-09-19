const {
  validate,
  createSiteVisitSchema,
  rescheduleSchema,
  cancelSchema,
  siteVisitIdParamSchema,
  listQuerySchema,
} = require('./validation');
const service = require('./service');
const { IdempotentReplay, idempotencyKeyFrom, assertIdempotencyKey } = require('../../lib/idempotency');

async function create(req, res, next) {
  try {
    const input = validate(createSiteVisitSchema, req.body);
    const key = idempotencyKeyFrom(req);
    assertIdempotencyKey(key);
    const result = await service.scheduleSiteVisit({
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

async function list(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const visits = await service.listSiteVisits({
      tenantPrisma: req.tenantPrisma,
      filters: {
        agentId: query.agentId,
        projectId: query.projectId,
        contactId: query.contactId,
        dealId: query.dealId,
        status: query.status,
        from: query.from,
        to: query.to,
      },
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(visits);
  } catch (err) {
    return next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const { siteVisitId } = validate(siteVisitIdParamSchema, req.params);
    const visit = await service.getSiteVisit({ tenantPrisma: req.tenantPrisma, siteVisitId });
    return res.json(visit);
  } catch (err) {
    return next(err);
  }
}

async function reschedule(req, res, next) {
  try {
    const { siteVisitId } = validate(siteVisitIdParamSchema, req.params);
    const data = validate(rescheduleSchema, req.body);
    const updated = await service.rescheduleSiteVisit({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      siteVisitId,
      scheduledAt: data.scheduledAt,
      durationMinutes: data.durationMinutes,
    });
    return res.json(updated);
  } catch (err) {
    return next(err);
  }
}

function lifecycle(target, needsReason) {
  return async (req, res, next) => {
    try {
      const { siteVisitId } = validate(siteVisitIdParamSchema, req.params);
      let cancellationReason;
      if (needsReason) {
        ({ cancellationReason } = validate(cancelSchema, req.body));
      }
      const updated = await service.transitionSiteVisit({
        tenantPrisma: req.tenantPrisma,
        organizationId: req.auth.organizationId,
        actorId: req.auth.userId,
        siteVisitId,
        target,
        cancellationReason,
      });
      return res.json(updated);
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  create,
  list,
  getOne,
  reschedule,
  confirm: lifecycle('CONFIRMED', false),
  cancel: lifecycle('CANCELLED', true),
  complete: lifecycle('COMPLETED', false),
  noShow: lifecycle('NO_SHOW', false),
};
