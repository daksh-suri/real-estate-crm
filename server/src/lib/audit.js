// Shared audit writer (Checkpoint 16 consolidation).
//
// All AuditLog rows go through writeAudit with the caller's transaction
// client. The helper never opens its own transaction: the audit row must
// commit or roll back together with the business mutation it describes.
//
// organizationId and actorId are always server-derived (tenant context +
// authenticated user). Client input is never trusted for either.
const { badRequestError } = require('./httpError');

const AUDIT_ACTIONS = Object.freeze({
  DEAL_CREATE: 'deal.create',
  DEAL_STAGE_TRANSITION: 'deal.stage_transition',
  DOCUMENT_VERIFY: 'document.verify',
  DOCUMENT_REJECT: 'document.reject',
  CONTACT_MERGE: 'contact.merge',
});

function assertAuditInput({ organizationId, actorId, entityType, entityId, action }) {
  if (!organizationId || typeof organizationId !== 'string') {
    throw badRequestError('writeAudit requires a server-derived organizationId');
  }
  if (!actorId || typeof actorId !== 'string') {
    throw badRequestError('writeAudit requires a server-derived actorId');
  }
  if (!entityType || typeof entityType !== 'string') {
    throw badRequestError('writeAudit requires entityType');
  }
  if (!entityId || typeof entityId !== 'string') {
    throw badRequestError('writeAudit requires entityId');
  }
  if (!action || typeof action !== 'string') {
    throw badRequestError('writeAudit requires action');
  }
}

// tx must be a tenant-scoped transaction client (tx.auditLog bound to the
// caller's transaction). A request-level client carries $transaction; a tx
// client does not — writing through the former would land the audit row
// outside the business transaction, so it is refused fail-closed.
async function writeAudit(tx, { organizationId, actorId, entityType, entityId, action, beforeState = null, afterState = null }) {
  if (!tx || !tx.auditLog || typeof tx.auditLog.create !== 'function' || typeof tx.$transaction === 'function') {
    throw badRequestError('writeAudit requires a transaction client (use inside $transaction)');
  }
  assertAuditInput({ organizationId, actorId, entityType, entityId, action });
  return tx.auditLog.create({
    data: {
      actorId,
      entityType,
      entityId,
      action,
      beforeState: beforeState ?? null,
      afterState: afterState ?? null,
    },
  });
}

module.exports = { writeAudit, AUDIT_ACTIONS };
