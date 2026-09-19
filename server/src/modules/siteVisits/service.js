const { idempotentCreate, recordIdempotency } = require('../../lib/idempotency');

const OPERATION_SITE_VISIT_CREATE = 'SITE_VISIT_CREATE';

// V1 scheduling constants (Phase 2 #14). No org-level duration configuration
// exists and none is built here: the 60-minute default applies unless a
// per-visit override within bounds is supplied. The 15-minute buffer applies
// between consecutive visits for the SAME AGENT only — never to projects.
const DEFAULT_DURATION_MINUTES = 60;
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 480;
const AGENT_BUFFER_MINUTES = 15;

// Only SCHEDULED/CONFIRMED rows consume availability. COMPLETED/CANCELLED/
// NO_SHOW are history and must never block future scheduling.
const ACTIVE_VISIT_STATUSES = ['SCHEDULED', 'CONFIRMED'];

// Explicit lifecycle map. Terminal/historical states have no exits.
// Listed literally (not generated) so the map is the auditable spec.
const ALLOWED_TRANSITIONS = {
  SCHEDULED: ['CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const { notFoundError, forbiddenError, badRequestError, conflictError } = require('../../lib/httpError');

// ---------------------------------------------------------------------------
// Reference resolvers (tx-bound). Availability/status of referenced rows is
// never gated here beyond alive + (for agents) ACTIVE — scheduling owns no
// other module's state.
// ---------------------------------------------------------------------------

const { resolveRef } = require('../../lib/refs');

async function resolveAgent({ tx, organizationId, agentId }) {
  return resolveRef({
    tx, organizationId, model: 'user', id: agentId,
    notFound: 'Agent not found',
    crossTenant: 'Cannot schedule a visit for an agent from another organization',
    softDeleted: 'Cannot schedule a visit for a soft-deleted user',
    checkActive: true,
    checkRawDeleted: false,
  });
}

async function resolveProject({ tx, organizationId, projectId }) {
  return resolveRef({
    tx, organizationId, model: 'project', id: projectId,
    notFound: 'Project not found',
    crossTenant: 'Cannot schedule a visit for a project from another organization',
    softDeleted: 'Cannot schedule a visit for a soft-deleted project',
  });
}

async function resolveContact({ tx, organizationId, contactId }) {
  return resolveRef({
    tx, organizationId, model: 'contact', id: contactId,
    notFound: 'Contact not found',
    crossTenant: 'Cannot schedule a visit for a contact from another organization',
    softDeleted: 'Cannot schedule a visit for a soft-deleted contact',
  });
}

async function resolveDeal({ tx, organizationId, dealId, contactId }) {
  const deal = await resolveRef({
    tx, organizationId, model: 'deal', id: dealId,
    notFound: 'Deal not found',
    crossTenant: 'Cannot schedule a visit for a deal from another organization',
    softDeleted: 'Cannot schedule a visit for a soft-deleted deal',
  });
  if (deal.contactId !== contactId) throw badRequestError('Deal does not belong to the visit contact');
  return deal;
}

// ---------------------------------------------------------------------------
// Locking + conflict detection.
// Lock order is deterministic (agent row, then project row) so concurrent
// schedulings involving the same pair in any combination cannot deadlock.
// The conflict re-check runs while the locks are held — the check-then-insert
// race is closed by serialization, not by optimism.
// ---------------------------------------------------------------------------

async function lockSchedulingResources({ tx, agentId, projectId }) {
  await tx._raw.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${agentId} FOR UPDATE`;
  await tx._raw.$queryRaw`SELECT "id" FROM "projects" WHERE "id" = ${projectId} FOR UPDATE`;
}

function visitEnd(start, durationMinutes) {
  return new Date(start.getTime() + durationMinutes * 60000);
}

async function assertSlotFree({ tx, agentId, projectId, start, durationMinutes, excludeId }) {
  const where = {
    status: { in: ACTIVE_VISIT_STATUSES },
    OR: [{ agentId }, { projectId }],
  };
  if (excludeId) where.id = { not: excludeId };
  const rows = await tx.siteVisit.findMany({ where });

  const end = visitEnd(start, durationMinutes);
  // Agent occupancy includes the mandatory buffer after the visit; project
  // occupancy does not (the buffer is agent-only per Phase 2 #14).
  const agentBusyUntil = new Date(end.getTime() + AGENT_BUFFER_MINUTES * 60000);

  for (const row of rows) {
    const rowStart = new Date(row.scheduledAt);
    const rowEnd = visitEnd(rowStart, row.durationMinutes);
    if (row.projectId === projectId && rowStart < end && rowEnd > start) {
      throw conflictError('Project already has a visit overlapping the requested slot');
    }
    if (row.agentId === agentId) {
      const rowAgentBusyUntil = new Date(rowEnd.getTime() + AGENT_BUFFER_MINUTES * 60000);
      if (rowStart < agentBusyUntil && rowAgentBusyUntil > start) {
        throw conflictError(
          'Agent already has a visit overlapping the requested slot (including 15-minute buffer)'
        );
      }
    }
  }
}

function assertFutureSlot(start) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw badRequestError('Invalid scheduledAt');
  }
  if (start.getTime() <= Date.now()) {
    throw badRequestError('scheduledAt must be in the future');
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function getSiteVisit({ tenantPrisma, siteVisitId }) {
  const visit = await tenantPrisma.siteVisit.findUnique({ where: { id: siteVisitId } });
  if (!visit) {
    throw notFoundError('SiteVisit not found');
  }
  return visit;
}

async function listSiteVisits({ tenantPrisma, filters = {}, limit = 20, offset = 0 }) {
  const where = {};
  for (const key of ['agentId', 'projectId', 'contactId', 'dealId', 'status']) {
    if (filters[key] !== undefined) where[key] = filters[key];
  }
  if (filters.from !== undefined || filters.to !== undefined) {
    where.scheduledAt = {};
    if (filters.from !== undefined) where.scheduledAt.gte = filters.from;
    if (filters.to !== undefined) where.scheduledAt.lte = filters.to;
  }
  return tenantPrisma.siteVisit.findMany({
    where,
    // A schedule reads naturally earliest-first, unlike createdAt-desc feeds.
    orderBy: { scheduledAt: 'asc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
}

// ---------------------------------------------------------------------------
// Scheduling (idempotent create). No Deal mutation, no Unit access, no audit
// rows: history lives on the visit row itself (status + cancellation triple),
// and Phase 3 mandates audit entries only for Deal create/transitions.
// ---------------------------------------------------------------------------

async function runScheduleTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, input }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      assertFutureSlot(input.scheduledAt);
      const durationMinutes = input.durationMinutes ?? DEFAULT_DURATION_MINUTES;

      await resolveAgent({ tx, organizationId, agentId: input.agentId });
      await resolveProject({ tx, organizationId, projectId: input.projectId });
      await resolveContact({ tx, organizationId, contactId: input.contactId });
      if (input.dealId) {
        await resolveDeal({ tx, organizationId, dealId: input.dealId, contactId: input.contactId });
      }

      await lockSchedulingResources({ tx, agentId: input.agentId, projectId: input.projectId });
      await assertSlotFree({
        tx,
        agentId: input.agentId,
        projectId: input.projectId,
        start: input.scheduledAt,
        durationMinutes,
      });

      const visit = await tx.siteVisit.create({
        data: {
          agentId: input.agentId,
          projectId: input.projectId,
          contactId: input.contactId,
          dealId: input.dealId || null,
          scheduledAt: input.scheduledAt,
          durationMinutes,
          status: 'SCHEDULED',
        },
      });

      const body = { siteVisit: visit };
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          organizationId,
          key: idempotencyKey,
          operationType: OPERATION_SITE_VISIT_CREATE,
          requestHash,
          responseBody: body,
        });
      }
      return body;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function scheduleSiteVisit({ tenantPrisma, organizationId, idempotencyKey, input }) {
  return idempotentCreate({
    client: tenantPrisma,
    organizationId,
    key: idempotencyKey,
    operationType: OPERATION_SITE_VISIT_CREATE,
    hashInput: {
      ...input,
      scheduledAt: input.scheduledAt instanceof Date ? input.scheduledAt.toISOString() : input.scheduledAt,
    },
    retryMessage: 'Concurrent scheduling conflict, please retry',
    run: (requestHash) => runScheduleTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, input }),
  });
}

// ---------------------------------------------------------------------------
// Lifecycle transitions + reschedule. Dedicated operations only — there is no
// generic PATCH because every mutable field is either immutable-by-design
// (relationships) or state-machine-governed (status, slot).
// ---------------------------------------------------------------------------

async function lockVisitRow({ tx, organizationId, siteVisitId }) {
  const locked = await tx._raw.$queryRaw`
    SELECT "id", "organizationId", "agentId", "projectId", "status"
    FROM "site_visits"
    WHERE "id" = ${siteVisitId}
    FOR UPDATE
  `;
  const row = locked && locked[0] ? locked[0] : null;
  if (!row || row.organizationId !== organizationId) {
    throw notFoundError('SiteVisit not found');
  }
  return row;
}

async function transitionSiteVisit({ tenantPrisma, organizationId, actorId, siteVisitId, target, cancellationReason }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const row = await lockVisitRow({ tx, organizationId, siteVisitId });

      const allowed = ALLOWED_TRANSITIONS[row.status] || [];
      if (!allowed.includes(target)) {
        throw badRequestError(`Invalid SiteVisit status transition ${row.status} -> ${target}`);
      }

      const data = { status: target };
      if (target === 'CANCELLED') {
        const reason = (cancellationReason ?? '').trim();
        if (!reason) {
          throw badRequestError('cancellationReason is required when cancelling a site visit');
        }
        data.cancelledBy = actorId;
        data.cancellationReason = reason;
        data.cancelledAt = new Date();
      }

      return tx.siteVisit.update({ where: { id: siteVisitId }, data });
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function rescheduleSiteVisit({ tenantPrisma, organizationId, siteVisitId, scheduledAt, durationMinutes }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const row = await lockVisitRow({ tx, organizationId, siteVisitId });
      if (row.status !== 'SCHEDULED' && row.status !== 'CONFIRMED') {
        throw badRequestError(`Only SCHEDULED or CONFIRMED visits can be rescheduled (current: ${row.status})`);
      }
      assertFutureSlot(scheduledAt);
      const nextDuration = durationMinutes ?? null;

      // Reuse the canonical resource lock order (agent, then project) so a
      // reschedule can never deadlock against a concurrent schedule.
      await lockSchedulingResources({ tx, agentId: row.agentId, projectId: row.projectId });

      const current = await tx.siteVisit.findUnique({ where: { id: siteVisitId } });
      await assertSlotFree({
        tx,
        agentId: row.agentId,
        projectId: row.projectId,
        start: scheduledAt,
        durationMinutes: nextDuration ?? current.durationMinutes,
        excludeId: siteVisitId,
      });

      const data = { scheduledAt };
      if (nextDuration !== null) data.durationMinutes = nextDuration;
      return tx.siteVisit.update({ where: { id: siteVisitId }, data });
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

module.exports = {
  getSiteVisit,
  listSiteVisits,
  scheduleSiteVisit,
  transitionSiteVisit,
  rescheduleSiteVisit,
};
