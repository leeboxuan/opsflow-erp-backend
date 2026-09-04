-- Requested pickup timing precision (date-only vs date+time).
-- Do not backfill: existing midnight values stay legacy (pickupDateHasTime NULL).

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "pickupDateHasTime" BOOLEAN;
