-- RETURN intake: allow Draft jobs/trips without a confirmed return depot.
-- Pending text preserves TBA/source wording and is never used as a real address.

ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "returningDepotPending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "returningDepotPendingText" TEXT;
