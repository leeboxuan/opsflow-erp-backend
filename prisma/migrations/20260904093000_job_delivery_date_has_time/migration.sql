-- Requested delivery timing (structured; not notes-only) + precision flag.
-- Do not backfill: existing jobs stay deliveryDate NULL / deliveryDateHasTime NULL.

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "deliveryDate" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "deliveryDateHasTime" BOOLEAN;
