-- Phase 3 (source only — DO NOT APPLY in this phase)
-- Additive indexes for job-finance set-based aggregation.
-- Safe / reversible: DROP INDEX IF EXISTS on rollback.

CREATE INDEX IF NOT EXISTS "trip_expenses_tenantId_jobId_reviewStatus_idx"
  ON "trip_expenses" ("tenantId", "jobId", "reviewStatus");

CREATE INDEX IF NOT EXISTS "invoices_tenantId_sourceJobId_status_idx"
  ON "invoices" ("tenantId", "sourceJobId", "status");
