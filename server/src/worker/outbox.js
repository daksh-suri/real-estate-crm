// Transactional outbox (Checkpoint 15). Rule: business mutation + event row
// commit in the SAME transaction (callers pass their tx as `client`), or
// both roll back. The processor claims PENDING rows atomically
// (UPDATE … FOR UPDATE SKIP LOCKED), dispatches OUTSIDE any lock, and marks
// PROCESSED only after success. At-least-once: a crash between dispatch and
// marking leaves the row retryable — providers get the stable event id as
// their idempotency key.
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

// Atomic claim: exactly one worker owns each row (increments attempts so a
// crash still counts toward the FAILED ceiling). Raw SQL because Prisma has
// no SKIP LOCKED support; the enum literal is cast explicitly.
async function claimOutboxEvents(client, { limit, now = new Date() } = {}) {
  const batch = Math.min(limit ?? config.worker.outboxBatchSize, 100);
  return client.$queryRaw`
    UPDATE "outbox_events" SET "attempts" = "attempts" + 1, "updatedAt" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "outbox_events"
      WHERE "status" = 'PENDING'::"OutboxStatus" AND "availableAt" <= ${now}
      ORDER BY "createdAt" ASC
      LIMIT ${batch}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "organizationId", "eventType", "payload", "attempts", "status"
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
  const out = { claimed: claimed.length, processed: 0, retried: 0, failed: 0 };
  for (const event of claimed) {
    try {
      const result = await dispatch(event, { client });
      const suppressed = result && result.suppressed;
      await client.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: 'PROCESSED',
          processedAt: now,
          lastError: suppressed ? `suppressed: ${result.reason}` : null,
        },
      });
      out.processed += 1;
    } catch (err) {
      if (event.attempts >= config.worker.maxAttempts) {
        await client.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'FAILED', failedAt: now, lastError: failureMessage(err) },
        });
        out.failed += 1;
      } else {
        await client.outboxEvent.update({
          where: { id: event.id },
          data: { availableAt: new Date(now.getTime() + computeBackoff(event.attempts)), lastError: failureMessage(err) },
        });
        out.retried += 1;
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
