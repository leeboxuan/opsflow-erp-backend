-- PSA / port storage rent last-day timing precision (date-only vs date+time).
-- Do not backfill: existing midnight values stay legacy (psaStorageRentLastDayHasTime NULL).

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "psaStorageRentLastDayHasTime" BOOLEAN;
