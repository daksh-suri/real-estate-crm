const {
  validate,
  createBookingSchema,
  bookingIdParamSchema,
  cancelBookingSchema,
  listQuerySchema,
} = require('./validation');
const service = require('./service');
const { IdempotentReplay, idempotencyKeyFrom, assertIdempotencyKey } = require('../../lib/idempotency');

async function create(req, res, next) {
  try {
    const input = validate(createBookingSchema, req.body);
    const key = idempotencyKeyFrom(req);
    assertIdempotencyKey(key);
    const result = await service.createBooking({
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
    const rows = await service.listBookings({
      tenantPrisma: req.tenantPrisma,
      filters: { unitId: query.unitId, dealId: query.dealId, reservationId: query.reservationId },
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
    const { bookingId } = validate(bookingIdParamSchema, req.params);
    const row = await service.getBooking({ tenantPrisma: req.tenantPrisma, bookingId });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

async function cancel(req, res, next) {
  try {
    const { bookingId } = validate(bookingIdParamSchema, req.params);
    const { cancellationReason } = validate(cancelBookingSchema, req.body);
    const row = await service.cancelBooking({
      tenantPrisma: req.tenantPrisma,
      organizationId: req.auth.organizationId,
      actorId: req.auth.userId,
      bookingId,
      cancellationReason,
    });
    return res.json(row);
  } catch (err) {
    return next(err);
  }
}

module.exports = { create, list, getOne, cancel };
