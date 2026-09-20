-- Forward-only corrective migration: converge the outbox claim-lease state
-- on ANY database (fresh, fully-migrated, or partial) without touching
-- history. Every statement is existence-guarded, so this is a no-op where
-- 20260920120000 already applied and healing where it did not.
--
-- Context: 20260920105433 used to ALTER claimedAt before the column existed,
-- which made fresh `prisma migrate deploy` fail. It is now a guarded no-op
-- when the column is absent; 20260920120000 then creates the lease state and
-- this migration converges any remainder (partial applies, manual DDL).

-- Lease enum value (guarded: ADD VALUE has no IF NOT EXISTS).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'OutboxStatus' AND e.enumlabel = 'PROCESSING'
  ) THEN
    ALTER TYPE "OutboxStatus" ADD VALUE 'PROCESSING';
  END IF;
END $$;

-- Lease column (guarded).
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMPTZ;

-- Normalize to the Prisma schema type (DateTime -> TIMESTAMP(3)) when the
-- column exists with the staging type. No data is destroyed (nullable).
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'outbox_events'
      AND column_name = 'claimedAt'
      AND udt_name = 'timestamptz'
  ) THEN
    ALTER TABLE "outbox_events" ALTER COLUMN "claimedAt" TYPE TIMESTAMP(3) USING "claimedAt"::TIMESTAMP(3);
  END IF;
END $$;

-- Claim/recovery selection predicate support (guarded).
CREATE INDEX IF NOT EXISTS "outbox_events_status_claimedAt_idx" ON "outbox_events"("status", "claimedAt");
