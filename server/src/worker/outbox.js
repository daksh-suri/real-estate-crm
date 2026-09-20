// Transactional outbox (Checkpoint 15, lease-hardened in the corrective
// pass). Rule: business mutation + event row commit in the SAME transaction
// (callers pass their tx as `client`), or both roll back. The processor
// claims rows atomically (UPDATE … FOR UPDATE SKIP LOCKED) into a durable
// PROCESSING lease, dispatches OUTSIDE any lock, and marks PROCESSED only
// after success — and only while it still owns the claim. At-least-once: a
// crash between dispatch and marking leaves the row reclaimable after the
// lease; providers get the stable event id as their idempotency key.
const { prisma } = require('../lib/prisma');
const config = require('../config');
const { dispatchNotification } = require('./notifications');

const EVENT_TYPES = {
  NOTIFICATION_INTERNAL: 'NOTIFICATION_INTERNAL',
  NOTIFICATION_CUSTOMER: 'NOTIFICATION_CUSTOMER',
};

function computeBackoff(attempts) {
  const { baseDelayMs, maxDelayMs } = config.worker;
  return Math.min(baseDelayMs * 2 ** Math.max(attempts - 1, 0), maxDelayMs);
}

function enqueueError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// Call inside the caller's business transaction: enqueueOutbox(tx, {...}).
async function enqueueOutbox(client, { organizationId, eventType, payload }) {
  if (!Object.values(EVENT_TYPES).includes(eventType)) {
    throw enqueueError(`Unknown outbox event type ${eventType}`);
  }
  if (!organizationId) {
    throw enqueueError('Outbox event requires organizationId');
  }
  return client.outboxEvent.create({
    data: { organizationId, eventType, payload: payload ?? {}, status: 'PENDING' },
  });
}

// Atomic claim with a durable lease: the UPDATE flips PENDING → PROCESSING
// (and stamps claimedAt) inside the same statement that selects the rows, so
// the claimed state is committed before any lock is released — a second
// worker can never claim the same event while the first dispatches it.
// Recovery needs no sweeper: PROCESSING rows whose claimedAt aged past the
// lease are claimable by the same query (crashed worker ⇒ new attempt).
// Raw SQL because Prisma has no SKIP LOCKED support; enum literals cast.
async function claimOutboxEvents(client, { limit, now = new Date() } = {}) {
  const batch = Math.min(limit ?? config.worker.outboxBatchSize, 100);
  const leaseCutoff = new Date(now.getTime() - config.worker.claimLeaseMs);
  return client.$queryRaw`
    UPDATE "outbox_events" SET "status" = 'PROCESSING'::"OutboxStatus", "claimedAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "outbox_events"
      WHERE ("status" = 'PENDING'::"OutboxStatus" AND "availableAt" <= ${now})
         OR ("status" = 'PROCESSING'::"OutboxStatus" AND "claimedAt" <= ${leaseCutoff})
      ORDER BY "createdAt" ASC
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "organizationId", "eventType", "payload", "attempts", "status", "claimedAt"
  `;
}

async function dispatchEvent(event, { client } = {}) {
  switch (event.eventType) {
    case EVENT_TYPES.NOTIFICATION_INTERNAL:
    case EVENT_TYPES.NOTIFICATION_CUSTOMER:
      return dispatchNotification(event, { client });
    default: {
      const err = new Error(`No handler for outbox event type ${event.eventType}`);
      err.statusCode = 400;
      throw err;
    }
  }
}

function failureMessage(err) {
  const message = err && err.message ? err.message : String(err);
  return message.slice(0, 2000);
}

async function processOutboxBatch({ client = prisma, dispatch = dispatchEvent, now = new Date() } = {}) {
  const claimed = await claimOutboxEvents(client, { now });
  const out = { claimed: claimed.length, processed: 0, retried: 0, failed: 0, stale: 0 };
  for (const event of claimed) {
    // Guarded terminal writes: only the current claim owner may resolve the
    // row. The predicate pins the exact claimedAt this worker received from
    // the claim statement: if our lease expired mid-dispatch and another
    // worker reclaimed it (same PROCESSING status, newer claimedAt), our
    // write affects 0 rows — counted as stale, never clobbering the new
    // owner's outcome. Retry semantics (backoff, ceiling) are unchanged.
    const resolveAs = async (data) => {
      const res = await client.outboxEvent.updateMany({
        where: { id: event.id, status: 'PROCESSING', claimedAt: event.claimedAt },
        data: { ...data, claimedAt: null },
      });
      return res.count === 1;
    };
    try {
      const result = await dispatch(event, { client });
      const suppressed = result && result.suppressed;
      const ok = await resolveAs({
        status: 'PROCESSED',
        processedAt: now,
        lastError: suppressed ? `suppressed: ${result.reason}` : null,
      });
      if (ok) out.processed += 1;
      else out.stale += 1;
    } catch (err) {
      if (event.attempts >= config.worker.maxAttempts) {
        const ok = await resolveAs({ status: 'FAILED', failedAt: now, lastError: failureMessage(err) });
        if (ok) out.failed += 1;
        else out.stale += 1;
      } else {
        // Back to PENDING with the next backoff window: the existing retry
        // contract (availableAt-gated reclaim) is preserved verbatim.
        const ok = await resolveAs({
          status: 'PENDING',
          availableAt: new Date(now.getTime() + computeBackoff(event.attempts)),
          lastError: failureMessage(err),
        });
        if (ok) out.retried += 1;
        else out.stale += 1;
      }
    }
  }
  return out;
}

module.exports = {
  EVENT_TYPES,
  computeBackoff,
  enqueueOutbox,
  claimOutboxEvents,
  dispatchEvent,
  processOutboxBatch,
};
