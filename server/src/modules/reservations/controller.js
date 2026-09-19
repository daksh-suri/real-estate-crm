const {
  validate,
  createReservationSchema,
  reservationIdParamSchema,
  listQuerySchema,
} = require('./validation');
const service = require('./service');
const { IdempotentReplay, idempotencyKeyFrom, assertIdempotencyKey } = require('../../lib/idempotency');

async function create(req, res, next) {
  try {
    const input = validate(createReservationSchema, req.body);
    const key = idempotencyKeyFrom(req);
    assertIdempotencyKey(key);
    const result = await service.createReservation({
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
    const rows = await service.listReservations({
      tenantPrisma: req.tenantPrisma,
      filters: { unitId: query.unitId, dealId: query.dealId, type: query.type, status: query.status },
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
    const { reservationId } = validate(reservationIdParamSchema, req.params);
    const row = await service.getReservation({ tenantPrisma: req.tenantPrisma, reservationId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function release(req, res, next) {
  try {
    const { reservationId } = validate(reservationIdParamSchema, req.params);
    const row = await service.releaseReservation({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      reservationId,
    });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getOne, release };
