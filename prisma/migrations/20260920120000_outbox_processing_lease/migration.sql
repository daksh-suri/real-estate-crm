-- Corrective pass: durable outbox claim lease (Issue 1).
-- A claimed event must be visibly PROCESSING before the claiming transaction
-- releases its lock, so a second worker can never claim the same event while
-- the first is dispatching it. Abandoned claims (crashed worker) become
-- reclaimable once claimedAt ages past the lease; no sweeper process needed.

-- New lease state on the existing status enum.
ALTER TYPE "OutboxStatus" ADD VALUE 'PROCESSING';

-- When this claim started; NULL unless status = PROCESSING.
ALTER TABLE "outbox_events" ADD COLUMN "claimedAt" TIMESTAMPTZ;

-- Claim/recovery selection predicate support.
CREATE INDEX "outbox_events_status_claimedAt_idx" ON "outbox_events"("status", "claimedAt");
