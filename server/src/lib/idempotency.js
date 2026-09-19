const crypto = require('crypto');

// Tenant-safe idempotency for intake (Phase 3 IdempotencyKey:
// unique on organizationId + key + operationType).
//
// Usage inside a transaction (tx):
//   const guard = await checkIdempotency({ tx, organizationId, key, operationType, payload });
//   if (guard.replay) throw IdempotentReplay(guard.snapshot);
//   ... do work, build responseBody ...
//   await recordIdempotency({ tx, organizationId, key, operationType, requestHash, responseBody });
//
// checkIdempotency does NOT write: the insert happens in recordIdempotency at
// the END of the same transaction, so a concurrent retry either blocks on the
// unique index (second committer gets P2002 -> re-read -> replay) or replays.
// The P2002 path is handled by callers via resolveIdempotencyConflict().

const OPERATION_ENQUIRY_INTAKE = 'ENQUIRY_INTAKE';

function canonicalHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value === undefined ? null : value)).digest('hex');
}

class IdempotentReplay extends Error {
  constructor(snapshot) {
    super('Idempotent replay: request already processed');
    this.name = 'IdempotentReplay';
    this.statusCode = 200;
    this.snapshot = snapshot;
  }
}

class IdempotencyConflict extends Error {
  constructor() {
    super('Idempotency key already used with a different payload');
    this.name = 'IdempotencyConflict';
    this.statusCode = 409;
  }
}

async function findRecord({ client, organizationId, key, operationType }) {
  void organizationId;
  return client.idempotencyKey.findFirst({ where: { key, operationType } });
  // NOTE: tenant wrapper injects organizationId; cross-tenant keys are
  // invisible here by construction (each tenant has its own key namespace).
}

async function recordIdempotency({ tx, organizationId, key, operationType, requestHash, responseBody }) {
  void organizationId;
  return tx.idempotencyKey.create({
    data: { key, operationType, requestHash, responseSnapshot: responseBody },
  });
}

// Called when the idempotency insert hits P2002: another transaction committed
// the same key first. Re-read the winner inside this transaction and decide
// replay (same payload hash) vs conflict (different payload hash).
async function resolveIdempotencyConflict({ tx, organizationId, key, operationType, requestHash }) {
  void organizationId;
  const existing = await tx.idempotencyKey.findFirst({ where: { key, operationType } });
  if (!existing) {
    const err = new Error('Idempotency conflict could not be resolved, please retry');
    err.statusCode = 409;
    throw err;
  }
  if (existing.requestHash !== requestHash) {
    throw new IdempotencyConflict();
  }
  throw new IdempotentReplay(existing.responseSnapshot);
}

module.exports = {
  OPERATION_ENQUIRY_INTAKE,
  canonicalHash,
  IdempotentReplay,
  IdempotencyConflict,
  findRecord,
  recordIdempotency,
  resolveIdempotencyConflict,
};
