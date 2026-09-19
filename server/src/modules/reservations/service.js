const { idempotentCreate, recordIdempotency } = require('../../lib/idempotency');

const OPERATION_RESERVATION_CREATE = 'RESERVATION_CREATE';
const OPERATION_HOLD_CREATE = 'HOLD_CREATE';

// Unit.availabilityStatus is the authoritative inventory state; this row's
// status is the record lifecycle. Both mutate in the same transaction while
// the Unit row is locked FOR UPDATE. Expected Unit state per ACTIVE type:
const UNIT_STATUS_FOR_TYPE = { RESERVATION: 'RESERVED', HOLD: 'ON_HOLD' };

const { notFoundError, forbiddenError, badRequestError, conflictError } = require('../../lib/httpError');

// ---------------------------------------------------------------------------
// Reference resolvers (tx-bound). The Unit's availability is NEVER gated
// here — the locked re-check owns it.
// ---------------------------------------------------------------------------

const { resolveRef } = require('../../lib/refs');

async function resolveUnit({ tx, organizationId, unitId }) {
  return resolveRef({
    tx, organizationId, model: 'unit', id: unitId,
    notFound: 'Unit not found',
    crossTenant: 'Cannot reserve a unit from another organization',
    softDeleted: 'Cannot reserve a soft-deleted unit',
  });
}

async function resolveDeal({ tx, organizationId, dealId }) {
  return resolveRef({
    tx, organizationId, model: 'deal', id: dealId,
    notFound: 'Deal not found',
    crossTenant: 'Cannot reserve for a deal from another organization',
    softDeleted: 'Cannot reserve for a soft-deleted deal',
  });
}

// ---------------------------------------------------------------------------
// Locking. The Unit row is the physical contention resource: whoever holds
// the lock re-checks availability authoritatively; the loser serializes
// behind and fails cleanly on the re-check. No app/redis/advisory locks.
// ---------------------------------------------------------------------------

async function lockUnitRow({ tx, organizationId, unitId }) {
  const locked = await tx._raw.$queryRaw`
    SELECT "id", "organizationId", "availabilityStatus"
    FROM "units"
    WHERE "id" = ${unitId}
    FOR UPDATE
  `;
  const row = locked && locked[0] ? locked[0] : null;
  if (!row || row.organizationId !== organizationId) {
    throw notFoundError('Unit not found');
  }
  return row;
}

function assertExpiresFuture(expiresAt) {
  if (expiresAt === undefined || expiresAt === null) return;
  if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime())) {
    throw badRequestError('Invalid expiresAt');
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw badRequestError('expiresAt must be in the future');
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function getReservation({ tenantPrisma, reservationId }) {
  const row = await tenantPrisma.reservation.findUnique({ where: { id: reservationId } });
  if (!row) throw notFoundError('Reservation not found');
  return row;
}

async function listReservations({ tenantPrisma, filters = {}, limit = 20, offset = 0 }) {
  const where = {};
  for (const key of ['unitId', 'dealId', 'type', 'status']) {
    if (filters[key] !== undefined) where[key] = filters[key];
  }
  return tenantPrisma.reservation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
}

// ---------------------------------------------------------------------------
// Creation (idempotent). RESERVATION and HOLD share this machinery; only the
// resulting Unit state differs (RESERVED vs ON_HOLD). No audit rows: Phase 3
// mandates them only for Deal create/transitions (+ merge/document/RERA).
// No outbox: dispatch belongs to the later background-jobs checkpoint.
// ---------------------------------------------------------------------------

function operationForType(type) {
  return type === 'HOLD' ? OPERATION_HOLD_CREATE : OPERATION_RESERVATION_CREATE;
}

async function runCreateTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, operationType, input }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      assertExpiresFuture(input.expiresAt);

      const unit = await resolveUnit({ tx, organizationId, unitId: input.unitId });
      const deal = await resolveDeal({ tx, organizationId, dealId: input.dealId });

      // Deal ↔ Unit consistency follows the Deal attach-once rule: a Deal
      // already bound to another Unit rejects; a unit-less Deal is bound here.
      if (deal.unitId && deal.unitId !== input.unitId) {
        throw badRequestError('Deal is already attached to a different unit');
      }

      const locked = await lockUnitRow({ tx, organizationId, unitId: input.unitId });
      if (locked.availabilityStatus !== 'AVAILABLE') {
        throw conflictError(`Unit is not available (current: ${locked.availabilityStatus})`);
      }

      const reservation = await tx.reservation.create({
        data: {
          unitId: input.unitId,
          dealId: input.dealId,
          type: input.type,
          expiresAt: input.expiresAt ?? null,
          status: 'ACTIVE',
        },
      });

      await tx.unit.update({
        where: { id: input.unitId },
        data: { availabilityStatus: UNIT_STATUS_FOR_TYPE[input.type] },
      });

      if (!deal.unitId) {
        await tx.deal.update({ where: { id: input.dealId }, data: { unitId: unit.id } });
      }

      const body = { reservation };
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          organizationId,
          key: idempotencyKey,
          operationType,
          requestHash,
          responseBody: body,
        });
      }
      return body;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function createReservation({ tenantPrisma, organizationId, idempotencyKey, input }) {
  const operationType = operationForType(input.type);
  return idempotentCreate({
    client: tenantPrisma,
    organizationId,
    key: idempotencyKey,
    operationType,
    hashInput: {
      ...input,
      expiresAt: input.expiresAt instanceof Date ? input.expiresAt.toISOString() : input.expiresAt ?? null,
    },
    retryMessage: 'Concurrent reservation conflict, please retry',
    run: (requestHash) => runCreateTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, operationType, input }),
  });
}

// ---------------------------------------------------------------------------
// Explicit release. ACTIVE → RELEASED only; terminals never reopen and never
// re-transition the Unit. The Unit is set AVAILABLE only when it still holds
// this reservation's expected state — never blindly.
// ---------------------------------------------------------------------------

async function releaseReservation({ tenantPrisma, organizationId, reservationId }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const current = await tx.reservation.findUnique({ where: { id: reservationId } });
      if (!current) throw notFoundError('Reservation not found');

      const locked = await lockUnitRow({ tx, organizationId, unitId: current.unitId });

      const row = await tx.reservation.findUnique({ where: { id: reservationId } });
      if (!row || row.status !== 'ACTIVE') {
        throw badRequestError(`Only ACTIVE reservations can be released (current: ${row ? row.status : 'missing'})`);
      }

      const expected = UNIT_STATUS_FOR_TYPE[row.type];
      if (locked.availabilityStatus !== expected) {
        throw conflictError(`Unit is not held by this reservation (current: ${locked.availabilityStatus})`);
      }

      const released = await tx.reservation.update({ where: { id: reservationId }, data: { status: 'RELEASED' } });
      await tx.unit.update({ where: { id: row.unitId }, data: { availabilityStatus: 'AVAILABLE' } });
      return released;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

// ---------------------------------------------------------------------------
// Expiry worker. Named job (no generic engine): expireDueReservations sweeps
// ACTIVE rows with expiresAt <= now, one transaction per candidate. Each
// transaction locks the Unit row, re-checks ACTIVE + past-due while holding
// the lock, then transitions. Re-run safe: terminal rows are no-ops, and a
// stale run never releases a Unit a newer reservation has since taken.
// ---------------------------------------------------------------------------

async function expireOneReservation({ rawPrisma, reservationId }) {
  return rawPrisma.$transaction(
    async (tx) => {
      const row = await tx.reservation.findFirst({ where: { id: reservationId } });
      if (!row || row.status !== 'ACTIVE') return { id: reservationId, skipped: true };
      if (!row.expiresAt || row.expiresAt.getTime() > Date.now()) return { id: reservationId, skipped: true };

      const locked = await tx.$queryRaw`
        SELECT "id", "organizationId", "availabilityStatus"
        FROM "units"
        WHERE "id" = ${row.unitId}
        FOR UPDATE
      `;
      const unit = locked && locked[0] ? locked[0] : null;
      if (!unit || unit.organizationId !== row.organizationId) return { id: reservationId, skipped: true };

      // Re-read while holding the lock: a racing release/expiry may have won.
      const fresh = await tx.reservation.findFirst({ where: { id: reservationId } });
      if (!fresh || fresh.status !== 'ACTIVE') return { id: reservationId, skipped: true };
      if (!fresh.expiresAt || fresh.expiresAt.getTime() > Date.now()) return { id: reservationId, skipped: true };

      await tx.reservation.update({ where: { id: reservationId }, data: { status: 'EXPIRED' } });
      const expected = UNIT_STATUS_FOR_TYPE[fresh.type];
      if (unit.availabilityStatus === expected) {
        await tx.unit.update({ where: { id: row.unitId }, data: { availabilityStatus: 'AVAILABLE' } });
      }
      return { id: reservationId, expired: true };
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function expireDueReservations({ rawPrisma, now = new Date(), limit = 100 } = {}) {
  const due = await rawPrisma.reservation.findMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } },
    select: { id: true },
    take: Math.min(limit, 500),
  });
  const out = { checked: due.length, expired: 0 };
  for (const { id } of due) {
    const r = await expireOneReservation({ rawPrisma, reservationId: id });
    if (r.expired) out.expired += 1;
  }
  return out;
}

module.exports = {
  createReservation,
  releaseReservation,
  getReservation,
  listReservations,
  expireDueReservations,
  expireOneReservation,
};
