-- Phase 5 — Dispatch day sequence ownership (SOURCE ONLY — DO NOT APPLY from agents)
-- Separates driver-day dispatch order from job-local tripSequence/jobSequence and routeVersion.

ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "dispatchSequence" INTEGER;
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "dispatchVersion" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "trips_tenantId_assignedDriverUserId_dispatchSequence_idx"
  ON "trips" ("tenantId", "assignedDriverUserId", "dispatchSequence");
