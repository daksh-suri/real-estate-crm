const { randomUUID } = require('crypto');
const { idempotentCreate, recordIdempotency } = require('../../lib/idempotency');
const { notFoundError, badRequestError, conflictError } = require('../../lib/httpError');
const { resolveRef } = require('../../lib/refs');
const { createUploadUrl, createAccessUrl, storageKeyFor } = require('../../lib/storage');

const OPERATION_DOCUMENT_CREATE = 'DOCUMENT_CREATE';
const OPERATION_RESUBMIT = 'DOCUMENT_RESUBMIT';

// Literal workflow map (Phase 3). REJECTED exits only via resubmit (new row);
// VERIFIED is terminal. Anything unlisted rejects.
const ALLOWED_TRANSITIONS = {
  NOT_SUBMITTED: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW'],
  UNDER_REVIEW: ['VERIFIED', 'REJECTED'],
  REJECTED: [],
  RESUBMITTED: ['SUBMITTED'],
  VERIFIED: [],
};

const AUDIT_ENTITY_DOCUMENT = 'Document';
const AUDIT_ACTION_VERIFY = 'document.verify';
const AUDIT_ACTION_REJECT = 'document.reject';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function getDocument({ tenantPrisma, documentId }) {
  const row = await tenantPrisma.document.findUnique({ where: { id: documentId } });
  if (!row) throw notFoundError('Document not found');
  return row;
}

async function listDocuments({ tenantPrisma, filters = {}, limit = 20, offset = 0 }) {
  const where = {};
  for (const key of ['contactId', 'dealId', 'groupId', 'status', 'type']) {
    if (filters[key] !== undefined) where[key] = filters[key];
  }
  return tenantPrisma.document.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    skip: offset,
  });
}

// ---------------------------------------------------------------------------
// Creation. storageKey is server-derived (org/contact/group/version) —
// never client-supplied. Idempotency-keyed: retries must not fork groups.
// ---------------------------------------------------------------------------

async function runCreateTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, input }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const contact = await resolveRef({
        tx, organizationId, model: 'contact', id: input.contactId,
        notFound: 'Contact not found',
        crossTenant: 'Cannot create a document for a contact from another organization',
        softDeleted: 'Cannot create a document for a soft-deleted contact',
      });
      let deal = null;
      if (input.dealId) {
        deal = await resolveRef({
          tx, organizationId, model: 'deal', id: input.dealId,
          notFound: 'Deal not found',
          crossTenant: 'Cannot create a document for a deal from another organization',
          softDeleted: 'Cannot create a document for a soft-deleted deal',
        });
        if (deal.contactId !== contact.id) {
          throw badRequestError('Deal does not belong to the document contact');
        }
      }

      const groupId = randomUUID();
      const document = await tx.document.create({
        data: {
          groupId,
          version: 1,
          supersedesId: null,
          contactId: contact.id,
          dealId: deal ? deal.id : null,
          type: input.type,
          status: 'NOT_SUBMITTED',
          storageKey: storageKeyFor({ organizationId, contactId: contact.id, groupId, version: 1 }),
        },
      });

      const body = { document };
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          organizationId,
          key: idempotencyKey,
          operationType: OPERATION_DOCUMENT_CREATE,
          requestHash,
          responseBody: body,
        });
      }
      return body;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function createDocument({ tenantPrisma, organizationId, idempotencyKey, input }) {
  return idempotentCreate({
    client: tenantPrisma,
    organizationId,
    key: idempotencyKey,
    operationType: OPERATION_DOCUMENT_CREATE,
    hashInput: { ...input },
    retryMessage: 'Concurrent document creation conflict, please retry',
    run: (requestHash) => runCreateTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, input }),
  });
}

// ---------------------------------------------------------------------------
// Signed URLs. Tenant + state verified before anything is signed; signing
// never mutates state, and generating a URL never counts as an upload.
// ---------------------------------------------------------------------------

async function getUploadUrl({ tenantPrisma, documentId }) {
  const row = await tenantPrisma.document.findUnique({ where: { id: documentId } });
  if (!row) throw notFoundError('Document not found');
  if (row.status !== 'NOT_SUBMITTED' && row.status !== 'RESUBMITTED') {
    throw badRequestError(`Upload URL is only available before review (current: ${row.status})`);
  }
  return createUploadUrl({ storageKey: row.storageKey });
}

async function getAccessUrl({ tenantPrisma, documentId }) {
  const row = await tenantPrisma.document.findUnique({ where: { id: documentId } });
  if (!row) throw notFoundError('Document not found');
  return createAccessUrl({ storageKey: row.storageKey });
}

// ---------------------------------------------------------------------------
// Agent-side progression. One locked transition each: lock row, re-check,
// mutate. Complete confirms a file landed (server-side); it never trusts a
// client claim beyond advancing the draft it already owns.
// ---------------------------------------------------------------------------

async function lockedTransition({ tenantPrisma, organizationId, documentId, from, to, extra = {} }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const locked = await tx._raw.$queryRaw`
        SELECT "id", "organizationId", "status"
        FROM "documents"
        WHERE "id" = ${documentId}
        FOR UPDATE
      `;
      const row = locked && locked[0] ? locked[0] : null;
      if (!row || row.organizationId !== organizationId) {
        throw notFoundError('Document not found');
      }
      if (!from.includes(row.status)) {
        throw badRequestError(`Only ${from.join(' or ')} documents can move to ${to} (current: ${row.status})`);
      }
      return tx.document.update({ where: { id: documentId }, data: { status: to, ...extra } });
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function completeUpload({ tenantPrisma, organizationId, documentId }) {
  return lockedTransition({
    tenantPrisma, organizationId, documentId,
    from: ['NOT_SUBMITTED', 'RESUBMITTED'], to: 'SUBMITTED',
  });
}

async function submitForReview({ tenantPrisma, organizationId, documentId }) {
  return lockedTransition({
    tenantPrisma, organizationId, documentId,
    from: ['SUBMITTED'], to: 'UNDER_REVIEW',
  });
}

// ---------------------------------------------------------------------------
// Review (Operations/Accounts, Manager, Admin via document:verify/reject
// grants — never role-name checks). Transition + reviewer metadata + audit
// row commit together, or all roll back.
// ---------------------------------------------------------------------------

async function reviewDocument({ tenantPrisma, organizationId, actorId, documentId, target, rejectionReason }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const locked = await tx._raw.$queryRaw`
        SELECT "id", "organizationId", "status", "rejectionReason", "reviewedBy", "reviewedAt"
        FROM "documents"
        WHERE "id" = ${documentId}
        FOR UPDATE
      `;
      const row = locked && locked[0] ? locked[0] : null;
      if (!row || row.organizationId !== organizationId) {
        throw notFoundError('Document not found');
      }
      if (!(ALLOWED_TRANSITIONS[row.status] || []).includes(target)) {
        throw badRequestError(`Invalid Document status transition ${row.status} -> ${target}`);
      }

      const data = { status: target, reviewedBy: actorId, reviewedAt: new Date() };
      if (target === 'REJECTED') {
        const reason = (rejectionReason ?? '').trim();
        if (!reason) {
          throw badRequestError('rejectionReason is required when rejecting a document');
        }
        data.rejectionReason = reason;
      } else {
        data.rejectionReason = null;
      }

      const updated = await tx.document.update({ where: { id: documentId }, data });
      await tx.auditLog.create({
        data: {
          actorId,
          entityType: AUDIT_ENTITY_DOCUMENT,
          entityId: documentId,
          action: target === 'VERIFIED' ? AUDIT_ACTION_VERIFY : AUDIT_ACTION_REJECT,
          beforeState: { status: row.status, rejectionReason: row.rejectionReason, reviewedBy: row.reviewedBy, reviewedAt: row.reviewedAt },
          afterState: { status: target, rejectionReason: updated.rejectionReason, reviewedBy: actorId, reviewedAt: updated.reviewedAt },
        },
      });
      return updated;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function verifyDocument({ tenantPrisma, organizationId, actorId, documentId }) {
  return reviewDocument({ tenantPrisma, organizationId, actorId, documentId, target: 'VERIFIED' });
}

async function rejectDocument({ tenantPrisma, organizationId, actorId, documentId, rejectionReason }) {
  return reviewDocument({ tenantPrisma, organizationId, actorId, documentId, target: 'REJECTED', rejectionReason });
}

// ---------------------------------------------------------------------------
// Resubmission — the concurrency core. New version row, never an overwrite:
// lock the target row first, re-check latest + REJECTED under lock, insert
// child (supersedesId @unique + live-group partial index backstop any
// residual race as P2002 → 409), record idempotency, commit.
// ---------------------------------------------------------------------------

async function runResubmitTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, documentId }) {
  return tenantPrisma.$transaction(
    async (tx) => {
      const locked = await tx._raw.$queryRaw`
        SELECT "id", "organizationId", "groupId", "version", "status", "contactId", "dealId", "type"
        FROM "documents"
        WHERE "id" = ${documentId}
        FOR UPDATE
      `;
      const row = locked && locked[0] ? locked[0] : null;
      if (!row || row.organizationId !== organizationId) {
        throw notFoundError('Document not found');
      }
      if (row.status !== 'REJECTED') {
        throw conflictError(`Only REJECTED documents can be resubmitted (current: ${row.status})`);
      }
      const latest = await tx._raw.$queryRaw`
        SELECT "id", "version", "status"
        FROM "documents"
        WHERE "groupId" = ${row.groupId}
        ORDER BY "version" DESC
        LIMIT 1
        FOR UPDATE
      `;
      const head = latest && latest[0] ? latest[0] : null;
      if (!head || head.id !== row.id) {
        throw conflictError('Only the latest version can be resubmitted');
      }

      const next = await tx.document.create({
        data: {
          groupId: row.groupId,
          version: row.version + 1,
          supersedesId: row.id,
          contactId: row.contactId,
          dealId: row.dealId,
          type: row.type,
          status: 'RESUBMITTED',
          storageKey: storageKeyFor({ organizationId, contactId: row.contactId, groupId: row.groupId, version: row.version + 1 }),
        },
      });

      const body = { document: next };
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          organizationId,
          key: idempotencyKey,
          operationType: OPERATION_RESUBMIT,
          requestHash,
          responseBody: body,
        });
      }
      return body;
    },
    { timeout: 10000, maxWait: 5000 }
  );
}

async function resubmitDocument({ tenantPrisma, organizationId, idempotencyKey, documentId }) {
  try {
    return await idempotentCreate({
      client: tenantPrisma,
      organizationId,
      key: idempotencyKey,
      operationType: OPERATION_RESUBMIT,
      hashInput: { documentId },
      retryMessage: 'Concurrent resubmission conflict, please retry',
      run: (requestHash) => runResubmitTransaction({ tenantPrisma, organizationId, idempotencyKey, requestHash, documentId }),
    });
  } catch (err) {
    // supersedesId-unique / live-group-index backstop for unkeyed races:
    // the pre-checks passed in both transactions, the loser hits P2002.
    if (!idempotencyKey && err.code === 'P2002') {
      throw conflictError('A newer version already exists for this document');
    }
    throw err;
  }
}

module.exports = {
  getDocument,
  listDocuments,
  createDocument,
  getUploadUrl,
  getAccessUrl,
  completeUpload,
  submitForReview,
  verifyDocument,
  rejectDocument,
  resubmitDocument,
};
