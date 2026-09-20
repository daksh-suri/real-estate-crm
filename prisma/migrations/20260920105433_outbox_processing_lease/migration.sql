-- Guarded normalization (repair 2026-09-20): on databases where
-- 20260920120000 was applied out of order (or the column otherwise
-- pre-exists), normalize claimedAt to TIMESTAMP(3). On fresh databases the
-- column does not exist yet -- 20260920120000 creates it later in timestamp
-- order -- so this step must be a no-op there instead of failing the deploy.
-- A plain ALTER here made fresh `prisma migrate deploy` impossible.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'outbox_events'
      AND column_name = 'claimedAt'
  ) THEN
    ALTER TABLE "outbox_events" ALTER COLUMN "claimedAt" TYPE TIMESTAMP(3) USING "claimedAt"::TIMESTAMP(3);
  END IF;
END $$;
