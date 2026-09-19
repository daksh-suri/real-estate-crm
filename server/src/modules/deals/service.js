const { dealStages } = require('./validation');

// Fixed V1 pipeline (Phase 3 #7). Forward chain plus CLOSED_LOST as a
// parallel terminal outcome reachable from any active stage. Terminal stages
// have no exits. Listed literally (not generated) so the map itself is the
// auditable specification.
const ACTIVE_STAGES = [
  'NEW',
  'QUALIFIED',
  'SITE_VISIT_SCHEDULED',
  'NEGOTIATION',
  'RESERVATION',
  'BOOKING_CONFIRMED',
  'AGREEMENT_SIGNED',
  'PAYMENT_IN_PROGRESS',
];

const ALLOWED_TRANSITIONS = {
  NEW: ['QUALIFIED', 'CLOSED_LOST'],
  QUALIFIED: ['SITE_VISIT_SCHEDULED', 'NEGOTIATION', 'CLOSED_LOST'],
  SITE_VISIT_SCHEDULED: ['NEGOTIATION', 'CLOSED_LOST'],
  NEGOTIATION: ['RESERVATION', 'CLOSED_LOST'],
  RESERVATION: ['BOOKING_CONFIRMED', 'CLOSED_LOST'],
  BOOKING_CONFIRMED: ['AGREEMENT_SIGNED', 'CLOSED_LOST'],
  AGREEMENT_SIGNED: ['PAYMENT_IN_PROGRESS', 'CLOSED_LOST'],
  PAYMENT_IN_PROGRESS: ['CLOSED_WON', 'CLOSED_LOST'],
  CLOSED_WON: [],
  CLOSED_LOST: [],
};

const AUDIT_ENTITY_DEAL = 'Deal';
const AUDIT_ACTION_CREATE = 'deal.create';
const AUDIT_ACTION_TRANSITION = 'deal.stage_transition';

function notFoundError(message) {
  const err = new Error(message);
  err.statusCode = 404;
  return err;
}

async function getDeal({ tenantPrisma, dealId }) {
  const deal = await tenantPrisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) {
    throw notFoundError('Deal not found');
  }
  return deal;
}

async function listDeals({ tenantPrisma, filters = {}, limit = 20, offset = 0 }) {
  const where = {};
  for (const key of ['stage', 'contactId', 'leadId', 'unitId']) {
    if (filters[key] !== undefined) where[key] = filters[key];
  }
  return tenantPrisma.deal.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
}

// Resolve an optional Unit reference for Deal attach: visible + alive rows
// pass; missing and cross-tenant rows hide as 404; same-org soft-deleted
// rows fail as 400 (resolveProject convention). Availability is NOT checked —
// Unit state belongs to the Reservation checkpoint, not Deal creation.
async function resolveUnitForDeal({ tx, organizationId, unitId }) {
  const unit = await tx.unit.findUnique({ where: { id: unitId } });
  if (unit) return unit;
  const raw = await tx._raw.unit.findUnique({ where: { id: unitId } });
  if (raw && raw.organizationId === organizationId && raw.deletedAt) {
    const err = new Error('Cannot attach deal to a soft-deleted unit');
    err.statusCode = 400;
    throw err;
  }
  throw notFoundError('Unit not found');
}

// Deal creation converts an OPEN Lead: creates the Deal at NEW, flips the
// Lead to CONVERTED, and writes the creation audit — atomically. Contact is
// derived from the Lead, never client-supplied.
async function createDeal({ tenantPrisma, organizationId, actorId, leadId, unitId }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      // Lock the Lead first so concurrent conversions of one Lead serialize;
      // the loser observes the CONVERTED status and fails cleanly.
      const locked = await tx._raw.$queryRaw`
        SELECT "id", "organizationId", "contactId", "status", "deletedAt"
        FROM "leads"
        WHERE "id" = ${leadId}
        FOR UPDATE
      `;
      const lead = locked && locked[0] ? locked[0] : null;
      // Conversion starts as a read: missing, cross-tenant, and soft-deleted
      // leads all hide as 404 (tenant read convention).
      if (!lead || lead.organizationId !== organizationId || lead.deletedAt) {
        throw notFoundError('Lead not found');
      }
      if (lead.status !== 'OPEN') {
        const err = new Error(`Lead must be OPEN to create a deal (current: ${lead.status})`);
        err.statusCode = 409;
        throw err;
      }

      let unit = null;
      if (unitId) {
        unit = await resolveUnitForDeal({ tx, organizationId, unitId });
      }

      const deal = await tx.deal.create({
        data: {
          contactId: lead.contactId,
          leadId: lead.id,
          unitId: unit ? unit.id : null,
          stage: 'NEW',
        },
      });

      await tx.lead.update({ where: { id: lead.id }, data: { status: 'CONVERTED' } });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: AUDIT_ENTITY_DEAL,
          entityId: deal.id,
          action: AUDIT_ACTION_CREATE,
          beforeState: null,
          afterState: { stage: 'NEW', leadId: lead.id, contactId: lead.contactId, unitId: unit ? unit.id : null },
        },
      });

      return deal;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

// Dedicated stage-transition operation: validates against the fixed map,
// enforces lostReason for CLOSED_LOST, and writes the audit row in the SAME
// transaction as the stage update. SITE_VISIT_SCHEDULED is a pipeline marker
// only — it never requires a SiteVisit record (that module is Checkpoint 10).
async function transitionDeal({ tenantPrisma, organizationId, actorId, dealId, stage, lostReason, fromStage }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const locked = await tx._raw.$queryRaw`
        SELECT "id", "organizationId", "stage", "lostReason", "deletedAt"
        FROM "deals"
        WHERE "id" = ${dealId}
        FOR UPDATE
      `;
      const row = locked && locked[0] ? locked[0] : null;
      if (!row || row.organizationId !== organizationId || row.deletedAt) {
        throw notFoundError('Deal not found');
      }

      if (fromStage !== undefined && row.stage !== fromStage) {
        const err = new Error(`Deal stage changed (expected ${fromStage}, current ${row.stage})`);
        err.statusCode = 409;
        throw err;
      }

      const allowed = ALLOWED_TRANSITIONS[row.stage] || [];
      if (!allowed.includes(stage)) {
        const err = new Error(`Invalid Deal stage transition ${row.stage} -> ${stage}`);
        err.statusCode = 400;
        throw err;
      }

      // lostReason invariant: required (non-blank) on CLOSED_LOST, cleared
      // everywhere else so stale reasons can never linger. Terminal stages
      // have no exits, so no reopening path can resurrect a cleared reason.
      let cleanReason = null;
      if (stage === 'CLOSED_LOST') {
        cleanReason = (lostReason ?? '').trim();
        if (!cleanReason) {
          const err = new Error('lostReason is required when closing a deal as lost');
          err.statusCode = 400;
          throw err;
        }
      }

      const updated = await tx.deal.update({
        where: { id: dealId },
        data: { stage, lostReason: cleanReason },
      });

      await tx.auditLog.create({
        data: {
          actorId,
          entityType: AUDIT_ENTITY_DEAL,
          entityId: dealId,
          action: AUDIT_ACTION_TRANSITION,
          beforeState: { stage: row.stage, lostReason: row.lostReason },
          afterState: { stage, lostReason: cleanReason },
        },
      });

      return updated;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

// Generic PATCH is narrow by design: attach a Unit to a unit-less Deal only.
// Stage/lostReason move exclusively via transitionDeal; contactId/leadId/
// organizationId are immutable (rejected before validation via raw-body check
// in the controller, mirrored here by the allowlist update shape).
async function updateDeal({ tenantPrisma, organizationId, dealId, data }) {
  const existing = await getDeal({ tenantPrisma, dealId });
  if (data.unitId === undefined) {
    const err = new Error('No valid fields to update');
    err.statusCode = 400;
    throw err;
  }
  if (data.unitId === null) {
    const err = new Error('Deal unit cannot be removed once attached');
    err.statusCode = 400;
    throw err;
  }
  if (existing.unitId) {
    const err = new Error('Deal unit cannot be changed once attached');
    err.statusCode = 400;
    throw err;
  }
  const unit = await tenantPrisma.unit.findUnique({ where: { id: data.unitId } });
  if (!unit) {
    const raw = await tenantPrisma._raw.unit.findUnique({ where: { id: data.unitId } });
    if (raw && raw.organizationId === organizationId && raw.deletedAt) {
      const err = new Error('Cannot attach deal to a soft-deleted unit');
      err.statusCode = 400;
      throw err;
    }
    throw notFoundError('Unit not found');
  }
  return tenantPrisma.deal.update({ where: { id: dealId }, data: { unitId: unit.id } });
}

async function deleteDeal({ tenantPrisma, dealId }) {
  await getDeal({ tenantPrisma, dealId });
  return tenantPrisma.deal.update({ where: { id: dealId }, data: { deletedAt: new Date() } });
}

module.exports = {
  dealStages,
  ACTIVE_STAGES,
  ALLOWED_TRANSITIONS,
  AUDIT_ENTITY_DEAL,
  AUDIT_ACTION_CREATE,
  AUDIT_ACTION_TRANSITION,
  getDeal,
  listDeals,
  createDeal,
  transitionDeal,
  updateDeal,
  deleteDeal,
};
