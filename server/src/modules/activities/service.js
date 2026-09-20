const { idempotentCreate, recordIdempotency, OPERATION_TASK_CREATE } = require('../../lib/idempotency');
const { notFoundError, forbiddenError, badRequestError, conflictError } = require('../../lib/httpError');
const { resolveRef } = require('../../lib/refs');

const OPERATION_ACTIVITY_CREATE = 'ACTIVITY_CREATE';

// OVERDUE is derived at read, never written: no scheduler exists and there
// is no auto-completion (see DEC-031).
function presentTask(task) {
  if (!task) return task;
  const status =
    task.status === 'OPEN' && new Date(task.dueAt).getTime() < Date.now() ? 'OVERDUE' : task.status;
  return { ...task, status };
}

// ---------------------------------------------------------------------------
// Shared resolvers. Contact/lead/deal links follow the siteVisit/document
// precedent: same-org + alive, with contact-consistency enforced when both
// ends are supplied. Assignees mirror lead-reassign semantics: same-org,
// alive, ACTIVE.
// ---------------------------------------------------------------------------

async function resolveContact({ tx, organizationId, contactId, owner }) {
  return resolveRef({
    tx, organizationId, model: 'contact', id: contactId,
    notFound: 'Contact not found',
    crossTenant: `Cannot attach ${owner} to a contact from another organization`,
    softDeleted: `Cannot attach ${owner} to a soft-deleted contact`,
  });
}

async function resolveLead({ tx, organizationId, leadId, contactId, owner }) {
  const lead = await resolveRef({
    tx, organizationId, model: 'lead', id: leadId,
    notFound: 'Lead not found',
    crossTenant: `Cannot attach ${owner} to a lead from another organization`,
    softDeleted: `Cannot attach ${owner} to a soft-deleted lead`,
  });
  if (contactId && lead.contactId !== contactId) {
    throw badRequestError(`Lead does not belong to the ${owner} contact`);
  }
  return lead;
}

async function resolveDeal({ tx, organizationId, dealId, contactId, owner }) {
  const deal = await resolveRef({
    tx, organizationId, model: 'deal', id: dealId,
    notFound: 'Deal not found',
    crossTenant: `Cannot attach ${owner} to a deal from another organization`,
    softDeleted: `Cannot attach ${owner} to a soft-deleted deal`,
  });
  if (contactId && deal.contactId !== contactId) {
    throw badRequestError(`Deal does not belong to the ${owner} contact`);
  }
  return deal;
}

async function resolveAssignee({ tx, organizationId, assignedTo }) {
  const user = await tx.user.findUnique({ where: { id: assignedTo } });
  if (user) {
    if (user.deletedAt) throw badRequestError('Cannot assign a task to a soft-deleted user');
    if (user.status !== 'ACTIVE') throw badRequestError(`Cannot assign a task to a ${user.status} user`);
    return user;
  }
  const raw = await tx._raw.user.findUnique({ where: { id: assignedTo } });
  if (raw && raw.organizationId !== organizationId) {
    throw forbiddenError('Cannot assign a task to a user from another organization');
  }
  if (raw && raw.organizationId === organizationId && raw.deletedAt) {
    throw badRequestError('Cannot assign a task to a soft-deleted user');
  }
  throw notFoundError('User not found');
}

// ---------------------------------------------------------------------------
// Activities (immutable log — no update/delete endpoints exist by design).
// ---------------------------------------------------------------------------

async function getActivity({ tenantPrisma, activityId }) {
  const row = await tenantPrisma.activity.findUnique({ where: { id: activityId } });
  if (!row) throw notFoundError('Activity not found');
  return row;
}

async function listActivities({ tenantPrisma, filters = {}, limit = 20, offset = 0 }) {
  const where = {};
  for (const key of ['contactId', 'leadId', 'dealId']) {
    if (filters[key] !== undefined) where[key] = filters[key];
  }
  return tenantPrisma.activity.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
}

async function runActivityTransaction({ tenantPrisma, organizationId, actorId, idempotencyKey, requestHash, input }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const contact = await resolveContact({ tx, organizationId, contactId: input.contactId, owner: 'activity' });
      let lead = null;
      if (input.leadId) lead = await resolveLead({ tx, organizationId, leadId: input.leadId, contactId: contact.id, owner: 'activity' });
      let deal = null;
      if (input.dealId) deal = await resolveDeal({ tx, organizationId, dealId: input.dealId, contactId: contact.id, owner: 'activity' });

      const activity = await tx.activity.create({
        data: {
          contactId: contact.id,
          leadId: lead ? lead.id : null,
          dealId: deal ? deal.id : null,
          type: input.type,
          outcome: input.outcome ?? null,
          notes: input.notes ?? null,
          createdBy: actorId,
        },
      });

      // Explicit follow-up only: the agent asked for a task in the same call.
      // No outcome sniffing, no auto-completion, no rules engine.
      let task = null;
      if (input.followUpTask) {
        const followUp = input.followUpTask;
        const assignee = await resolveAssignee({ tx, organizationId, assignedTo: followUp.assignedTo });
        const relatedContact = followUp.relatedContactId
          ? await resolveContact({ tx, organizationId, contactId: followUp.relatedContactId, owner: 'task' })
          : null;
        const relatedDeal = followUp.relatedDealId
          ? await resolveDeal({ tx, organizationId, dealId: followUp.relatedDealId, contactId: relatedContact ? relatedContact.id : null, owner: 'task' })
          : null;
        task = await tx.task.create({
          data: {
            assignedTo: assignee.id,
            relatedContactId: relatedContact ? relatedContact.id : null,
            relatedDealId: relatedDeal ? relatedDeal.id : null,
            title: followUp.title,
            dueAt: followUp.dueAt,
            status: 'OPEN',
            createdBy: actorId,
          },
        });
      }

      const body = task ? { activity, task } : { activity };
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          organizationId,
          key: idempotencyKey,
          operationType: OPERATION_ACTIVITY_CREATE,
          requestHash,
          responseBody: body,
        });
      }
      return body;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function createActivity({ tenantPrisma, organizationId, actorId, idempotencyKey, input }) {
  return idempotentCreate({
    client: tenantPrisma,
    organizationId,
    key: idempotencyKey,
    operationType: OPERATION_ACTIVITY_CREATE,
    hashInput: { ...input },
    retryMessage: 'Concurrent activity creation conflict, please retry',
    run: (requestHash) => runActivityTransaction({ tenantPrisma, organizationId, actorId, idempotencyKey, requestHash, input }),
  });
}

// ---------------------------------------------------------------------------
// Tasks. OPEN → DONE via dedicated complete only; DONE is terminal.
// Inbound activities never complete tasks — separate events, separate calls.
// ---------------------------------------------------------------------------

async function getTask({ tenantPrisma, taskId }) {
  const row = await tenantPrisma.task.findUnique({ where: { id: taskId } });
  if (!row) throw notFoundError('Task not found');
  return presentTask(row);
}

async function listTasks({ tenantPrisma, filters = {}, limit = 20, offset = 0 }) {
  const where = {};
  if (filters.assignedTo !== undefined) where.assignedTo = filters.assignedTo;
  if (filters.status === 'OVERDUE') {
    where.status = 'OPEN';
    where.dueAt = { lt: new Date() };
  } else if (filters.status !== undefined) {
    where.status = filters.status;
  }
  const rows = await tenantPrisma.task.findMany({
    where,
    orderBy: { dueAt: 'asc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
  return rows.map(presentTask);
}

async function runTaskTransaction({ tenantPrisma, organizationId, actorId, idempotencyKey, requestHash, input }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const assignee = await resolveAssignee({ tx, organizationId, assignedTo: input.assignedTo });
      const relatedContact = input.relatedContactId
        ? await resolveContact({ tx, organizationId, contactId: input.relatedContactId, owner: 'task' })
        : null;
      const relatedDeal = input.relatedDealId
        ? await resolveDeal({ tx, organizationId, dealId: input.relatedDealId, contactId: relatedContact ? relatedContact.id : null, owner: 'task' })
        : null;
      const task = await tx.task.create({
        data: {
          assignedTo: assignee.id,
          relatedContactId: relatedContact ? relatedContact.id : null,
          relatedDealId: relatedDeal ? relatedDeal.id : null,
          title: input.title,
          dueAt: input.dueAt,
          status: 'OPEN',
          createdBy: actorId,
        },
      });
      const body = presentTask(task);
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          organizationId,
          key: idempotencyKey,
          operationType: OPERATION_TASK_CREATE,
          requestHash,
          responseBody: body,
        });
      }
      return body;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function createTask({ tenantPrisma, organizationId, actorId, idempotencyKey, input }) {
  return idempotentCreate({
    client: tenantPrisma,
    organizationId,
    key: idempotencyKey,
    operationType: OPERATION_TASK_CREATE,
    hashInput: { ...input },
    retryMessage: 'Concurrent task creation conflict, please retry',
    run: (requestHash) =>
      runTaskTransaction({ tenantPrisma, organizationId, actorId, idempotencyKey, requestHash, input }),
  });
}

async function completeTask({ tenantPrisma, organizationId, taskId }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const locked = await tx._raw.$queryRaw`
        SELECT "id", "organizationId", "status"
        FROM "tasks"
        WHERE "id" = ${taskId}
        FOR UPDATE
      `;
      const row = locked && locked[0] ? locked[0] : null;
      if (!row || row.organizationId !== organizationId) {
        throw notFoundError('Task not found');
      }
      if (row.status !== 'OPEN') {
        throw conflictError(`Only OPEN tasks can be completed (current: ${row.status})`);
      }
      const updated = await tx.task.update({ where: { id: taskId }, data: { status: 'DONE' } });
      return presentTask(updated);
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

module.exports = {
  getActivity,
  listActivities,
  createActivity,
  getTask,
  listTasks,
  createTask,
  completeTask,
};
