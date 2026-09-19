const { validate, intakeSchema, enquiryIdParamSchema, listQuerySchema } = require('./validation');
const service = require('./service');
const { IdempotentReplay, idempotencyKeyFrom, assertIdempotencyKey } = require('../../lib/idempotency');

async function intake(req, res, next) {
  try {
    const input = validate(intakeSchema, req.body);
    const key = idempotencyKeyFrom(req);
    assertIdempotencyKey(key);
    const result = await service.intakeEnquiry({
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

async function getOne(req, res, next) {
  try {
    const { enquiryId } = validate(enquiryIdParamSchema, req.params);
    const row = await service.getEnquiry({ tenantPrisma: req.tenantPrisma, enquiryId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function list(req, res, next) {
  try {
    const query = validate(listQuerySchema, req.query);
    const rows = await service.listEnquiries({
      tenantPrisma: req.tenantPrisma,
      filters: {
        channel: query.channel,
        contactId: query.contactId,
        projectId: query.projectId,
        leadSourceId: query.leadSourceId,
        campaignId: query.campaignId,
        linkedLeadId: query.linkedLeadId,
      },
      limit: query.limit,
      offset: query.offset,
    });
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
}

module.exports = { intake, getOne, list };
