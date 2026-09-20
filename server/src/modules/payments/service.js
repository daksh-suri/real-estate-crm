const { idempotentCreate, recordIdempotency } = require('../../lib/idempotency');
const { createTenantPrisma } = require('../../lib/tenant');
const { notFoundError, forbiddenError, badRequestError, conflictError } = require('../../lib/httpError');
const { resolveRef } = require('../../lib/refs');

const OPERATION_PLAN_CREATE = 'PAYMENT_PLAN_CREATE';
const OPERATION_WEBHOOK = 'PAYMENT_WEBHOOK';

// OVERDUE is derived at read, never written: no scheduler exists and the
// webhook stays the sole PAID writer (see DEC-029).
function presentObligation(ob) {
  if (!ob) return ob;
  const status = ob.status === 'PENDING' && new Date(ob.dueDate).getTime() < Date.now() ? 'OVERDUE' : ob.status;
  return { ...ob, status };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function getPlan({ tenantPrisma, planId }) {
  const plan = await tenantPrisma.paymentPlan.findUnique({ where: { id: planId }, include: { obligations: true } });
  if (!plan) throw notFoundError('PaymentPlan not found');
  return { ...plan, obligations: plan.obligations.map(presentObligation) };
}

async function listPlans({ tenantPrisma, filters = {}, limit = 20, offset = 0 }) {
  const where = {};
  if (filters.dealId !== undefined) where.dealId = filters.dealId;
  return tenantPrisma.paymentPlan.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
}

async function getObligation({ tenantPrisma, obligationId }) {
  const ob = await tenantPrisma.paymentObligation.findUnique({ where: { id: obligationId }, include: { records: true } });
  if (!ob) throw notFoundError('PaymentObligation not found');
  return presentObligation(ob);
}

async function getRecord({ tenantPrisma, recordId }) {
  const row = await tenantPrisma.paymentRecord.findUnique({ where: { id: recordId } });
  if (!row) throw notFoundError('PaymentRecord not found');
  return row;
}

// ---------------------------------------------------------------------------
// Plan generation (explicit, idempotent). Deal-specific schedules only:
// the obligations array IS the custom schedule (see DEC-029). Booking is
// only the entry context — its state is never touched here.
// ---------------------------------------------------------------------------

async function runPlanTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, input }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: input.bookingId } });
      if (!booking) {
        const raw = await tx._raw.booking.findFirst({ where: { id: input.bookingId } });
        if (raw && raw.organizationId !== organizationId) {
          throw forbiddenError('Cannot create a payment plan for a booking from another organization');
        }
        throw notFoundError('Booking not found');
      }
      if (input.dealId && input.dealId !== booking.dealId) {
        throw badRequestError('dealId does not match the booking deal');
      }
      const deal = await resolveRef({
        tx, organizationId, model: 'deal', id: booking.dealId,
        notFound: 'Deal not found',
        crossTenant: 'Cannot create a payment plan for a deal from another organization',
        softDeleted: 'Cannot create a payment plan for a soft-deleted deal',
      });

      const existing = await tx.paymentPlan.findFirst({ where: { dealId: deal.id } });
      if (existing) {
        throw conflictError('PaymentPlan already exists for this deal');
      }

      const plan = await tx.paymentPlan.create({ data: { dealId: deal.id } });
      const obligations = [];
      for (const item of input.obligations) {
        obligations.push(
          await tx.paymentObligation.create({
            data: { paymentPlanId: plan.id, dueAmount: item.dueAmount, dueDate: item.dueDate, status: 'PENDING' },
          })
        );
      }

      const body = { plan, obligations: obligations.map(presentObligation) };
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          organizationId,
          key: idempotencyKey,
          operationType: OPERATION_PLAN_CREATE,
          requestHash,
          responseBody: body,
        });
      }
      return body;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function createPlan({ tenantPrisma, organizationId, idempotencyKey, input }) {
  // dealId intentionally excluded from the hash: it is a cross-check, not
  // identity — the booking carries the authority.
  const hashInput = { bookingId: input.bookingId, obligations: input.obligations };
  try {
    return await idempotentCreate({
      client: tenantPrisma,
      organizationId,
      key: idempotencyKey,
      operationType: OPERATION_PLAN_CREATE,
      hashInput,
      retryMessage: 'Concurrent plan creation conflict, please retry',
      run: (requestHash) => runPlanTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, input }),
    });
  } catch (err) {
    // Unique(dealId) backstop for unkeyed races: the pre-check passed in
    // both transactions, the loser hits P2002 — report 409, never raw P2002.
    if (!idempotencyKey && err.code === 'P2002') {
      throw conflictError('PaymentPlan already exists for this deal');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Webhook (provider-neutral, HMAC-authenticated at the controller boundary —
// see lib/webhookAuth and DEC-029). The gateway eventId
// is the idempotency key; the tenant is derived from the obligation row,
// never trusted from the body. Record + obligation transition are atomic.
// ---------------------------------------------------------------------------

async function runWebhookTransaction({ tenantPrisma, organizationId, requestHash, eventId, input }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const locked = await tx._raw.$queryRaw`
        SELECT "id", "organizationId", "status"
        FROM "payment_obligations"
        WHERE "id" = ${input.obligationId}
        FOR UPDATE
      `;
      const row = locked && locked[0] ? locked[0] : null;
      if (!row || row.organizationId !== organizationId) {
        throw notFoundError('PaymentObligation not found');
      }

      const obligation = await tx.paymentObligation.findUnique({ where: { id: input.obligationId } });
      if (!obligation) throw notFoundError('PaymentObligation not found');
      if (input.outcome === 'SUCCESS' && obligation.status === 'PAID') {
        throw conflictError('PaymentObligation is already PAID');
      }

      let correctsRecordId = null;
      if (input.correctsRecordId) {
        const original = await tx.paymentRecord.findUnique({ where: { id: input.correctsRecordId } });
        if (!original) throw notFoundError('Corrected PaymentRecord not found');
        if (original.obligationId !== obligation.id) {
          throw badRequestError('Corrected record belongs to a different obligation');
        }
        correctsRecordId = original.id;
      }

      const record = await tx.paymentRecord.create({
        data: {
          obligationId: obligation.id,
          amount: input.amount,
          status: input.outcome,
          gatewayReference: input.gatewayReference ?? null,
          correctsRecordId,
        },
      });

      let updated = obligation;
      if (input.outcome === 'SUCCESS') {
        updated = await tx.paymentObligation.update({ where: { id: obligation.id }, data: { status: 'PAID' } });
      }

      const body = { record, obligation: presentObligation(updated) };
      await recordIdempotency({
        tx,
        organizationId,
        key: eventId,
        operationType: OPERATION_WEBHOOK,
        requestHash,
        responseBody: body,
      });
      return body;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function processWebhook({ rawPrisma, input }) {
  // Tenant derived from the trusted row — organizationId never comes from
  // the untrusted body.
  const obligation = await rawPrisma.paymentObligation.findFirst({ where: { id: input.obligationId } });
  if (!obligation) throw notFoundError('PaymentObligation not found');
  const organizationId = obligation.organizationId;
  const tenantPrisma = createTenantPrisma(organizationId);

  return idempotentCreate({
    client: tenantPrisma,
    organizationId,
    key: input.eventId,
    operationType: OPERATION_WEBHOOK,
    hashInput: {
      obligationId: input.obligationId,
      amount: input.amount,
      outcome: input.outcome,
      gatewayReference: input.gatewayReference ?? null,
      correctsRecordId: input.correctsRecordId ?? null,
    },
    retryMessage: 'Concurrent webhook conflict, please retry',
    run: (requestHash) => runWebhookTransaction({ tenantPrisma, organizationId, requestHash, eventId: input.eventId, input }),
  });
}

module.exports = {
  getPlan,
  listPlans,
  getObligation,
  getRecord,
  createPlan,
  processWebhook,
};
