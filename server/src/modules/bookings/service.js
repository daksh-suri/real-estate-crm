const { idempotentCreate, recordIdempotency } = require('../../lib/idempotency');

const OPERATION_BOOKING_CREATE = 'BOOKING_CREATE';

const { notFoundError, forbiddenError, badRequestError, conflictError } = require('../../lib/httpError');

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function getBooking({ tenantPrisma, bookingId }) {
  const row = await tenantPrisma.booking.findUnique({ where: { id: bookingId } });
  if (!row) throw notFoundError('Booking not found');
  return row;
}

async function listBookings({ tenantPrisma, filters = {}, limit = 20, offset = 0 }) {
  const where = {};
  for (const key of ['unitId', 'dealId', 'reservationId']) {
    if (filters[key] !== undefined) where[key] = filters[key];
  }
  return tenantPrisma.booking.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
}

// ---------------------------------------------------------------------------
// Conversion (idempotent). ACTIVE type=RESERVATION row → Booking insert +
// Unit RESERVED → BOOKED + Reservation ACTIVE → CONVERTED, atomically under
// the Unit FOR UPDATE lock (Checkpoint 10 pattern). No Deal.stage move —
// the agent drives stage via the existing transition op. No audit rows:
// Phase 3 mandates them only for Deal create/transitions (+ merge/document).
// ---------------------------------------------------------------------------

async function runCreateTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, input }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const reservation = await tx.reservation.findUnique({ where: { id: input.reservationId } });
      if (!reservation) {
        const raw = await tx._raw.reservation.findFirst({ where: { id: input.reservationId } });
        if (raw && raw.organizationId !== organizationId) {
          throw forbiddenError('Cannot book a reservation from another organization');
        }
        throw notFoundError('Reservation not found');
      }
      if (reservation.status !== 'ACTIVE') {
        throw conflictError(`Only ACTIVE reservations can be booked (current: ${reservation.status})`);
      }
      if (reservation.type !== 'RESERVATION') {
        throw badRequestError(`Only type RESERVATION can be booked (current: ${reservation.type})`);
      }
      if (input.unitId && input.unitId !== reservation.unitId) {
        throw badRequestError('unitId does not match the reservation unit');
      }
      if (input.dealId && input.dealId !== reservation.dealId) {
        throw badRequestError('dealId does not match the reservation deal');
      }

      const locked = await tx._raw.$queryRaw`
        SELECT "id", "organizationId", "availabilityStatus"
        FROM "units"
        WHERE "id" = ${reservation.unitId}
        FOR UPDATE
      `;
      const unit = locked && locked[0] ? locked[0] : null;
      if (!unit || unit.organizationId !== organizationId) {
        throw notFoundError('Unit not found');
      }

      // Re-read under the lock: a racing release/expiry/booking may have won.
      const fresh = await tx.reservation.findUnique({ where: { id: input.reservationId } });
      if (!fresh || fresh.status !== 'ACTIVE') {
        throw conflictError(`Only ACTIVE reservations can be booked (current: ${fresh ? fresh.status : 'missing'})`);
      }
      if (unit.availabilityStatus !== 'RESERVED') {
        throw conflictError(`Unit is not reserved (current: ${unit.availabilityStatus})`);
      }

      const booking = await tx.booking.create({
        data: {
          unitId: reservation.unitId,
          dealId: reservation.dealId,
          reservationId: reservation.id,
        },
      });

      await tx.unit.update({ where: { id: reservation.unitId }, data: { availabilityStatus: 'BOOKED' } });
      await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'CONVERTED' } });

      const body = { booking };
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          organizationId,
          key: idempotencyKey,
          operationType: OPERATION_BOOKING_CREATE,
          requestHash,
          responseBody: body,
        });
      }
      return body;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function createBooking({ tenantPrisma, organizationId, idempotencyKey, input }) {
  return idempotentCreate({
    client: tenantPrisma,
    organizationId,
    key: idempotencyKey,
    operationType: OPERATION_BOOKING_CREATE,
    hashInput: { ...input },
    retryMessage: 'Concurrent booking conflict, please retry',
    run: (requestHash) => runCreateTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, input }),
  });
}

// ---------------------------------------------------------------------------
// Cancellation. Dedicated op only — no PATCH/DELETE. Preserves the row,
// stamps the shared triple server-side, and reverses BOOKED → AVAILABLE.
// The Reservation stays CONVERTED (conversion history, never reopened).
// ---------------------------------------------------------------------------

async function cancelBooking({ tenantPrisma, organizationId, actorId, bookingId, cancellationReason }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const current = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!current) throw notFoundError('Booking not found');
      if (current.cancelledAt) {
        throw badRequestError('Booking is already cancelled');
      }

      const reason = (cancellationReason ?? '').trim();
      if (!reason) {
        throw badRequestError('cancellationReason is required when cancelling a booking');
      }

      const locked = await tx._raw.$queryRaw`
        SELECT "id", "organizationId", "availabilityStatus"
        FROM "units"
        WHERE "id" = ${current.unitId}
        FOR UPDATE
      `;
      const unit = locked && locked[0] ? locked[0] : null;
      if (!unit || unit.organizationId !== organizationId) {
        throw notFoundError('Unit not found');
      }

      const fresh = await tx.booking.findUnique({ where: { id: bookingId } });
      if (!fresh) throw notFoundError('Booking not found');
      if (fresh.cancelledAt) {
        throw badRequestError('Booking is already cancelled');
      }

      const cancelled = await tx.booking.update({
        where: { id: bookingId },
        data: { cancelledBy: actorId, cancellationReason: reason, cancelledAt: new Date() },
      });
      if (unit.availabilityStatus === 'BOOKED') {
        await tx.unit.update({ where: { id: current.unitId }, data: { availabilityStatus: 'AVAILABLE' } });
      }
      return cancelled;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

module.exports = {
  createBooking,
  cancelBooking,
  getBooking,
  listBookings,
};
