-- Phase 4 — multi job types + trip type (SOURCE ONLY — DO NOT APPLY)
-- Expand → backfill → (optional later) contract.
-- Safe order: 1) preflight-pre-migration.sql  2) this migration  3) optional preflight-post-expand.sql
-- Do not invent a default such as COLLECTION for Trip.tripType.
-- Trip.tripType remains NULLABLE here (new writes require it in app; DB contract NOT NULL is later).

-- ========== EXPAND ==========
-- Tenant-matched parent key for composite FKs
CREATE UNIQUE INDEX IF NOT EXISTS "jobs_tenantId_id_key" ON "jobs" ("tenantId", "id");

-- Compatibility singular may be null for multi-type jobs
ALTER TABLE "jobs" ALTER COLUMN "jobType" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "job_type_assignments" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "jobType" "JobType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_type_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "job_type_assignments_tenantId_jobId_jobType_key"
  ON "job_type_assignments" ("tenantId", "jobId", "jobType");

CREATE INDEX IF NOT EXISTS "job_type_assignments_tenantId_jobId_idx"
  ON "job_type_assignments" ("tenantId", "jobId");

CREATE INDEX IF NOT EXISTS "job_type_assignments_tenantId_jobType_idx"
  ON "job_type_assignments" ("tenantId", "jobType");

ALTER TABLE "job_type_assignments"
  DROP CONSTRAINT IF EXISTS "job_type_assignments_tenantId_fkey";
ALTER TABLE "job_type_assignments"
  ADD CONSTRAINT "job_type_assignments_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Composite FK: assignment tenant+job must match jobs.tenantId+id (blocks cross-tenant jobId)
ALTER TABLE "job_type_assignments"
  DROP CONSTRAINT IF EXISTS "job_type_assignments_jobId_fkey";
ALTER TABLE "job_type_assignments"
  DROP CONSTRAINT IF EXISTS "job_type_assignments_tenantId_jobId_fkey";
ALTER TABLE "job_type_assignments"
  ADD CONSTRAINT "job_type_assignments_tenantId_jobId_fkey"
  FOREIGN KEY ("tenantId", "jobId") REFERENCES "jobs"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable expand for Trip.tripType (app requires on new writes; DB NOT NULL is a later contract migration)
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "tripType" "JobType";

CREATE INDEX IF NOT EXISTS "trips_tenantId_jobId_tripType_idx"
  ON "trips" ("tenantId", "jobId", "tripType");

-- ========== BACKFILL ==========
-- One assignment from each valid legacy Job.jobType (idempotent).
INSERT INTO "job_type_assignments" ("id", "tenantId", "jobId", "jobType", "createdAt")
SELECT
  md5(j."tenantId" || ':' || j."id" || ':' || j."jobType"::text),
  j."tenantId",
  j."id",
  j."jobType",
  NOW()
FROM "jobs" j
WHERE j."jobType" IS NOT NULL
ON CONFLICT ("tenantId", "jobId", "jobType") DO NOTHING;

-- Legacy trips: copy parent job's valid legacy type when tripType is null.
UPDATE "trips" t
SET "tripType" = j."jobType"
FROM "jobs" j
WHERE t."jobId" = j."id"
  AND t."tenantId" = j."tenantId"
  AND t."tripType" IS NULL
  AND j."jobType" IS NOT NULL;

-- ========== CONTRACT (later migration only — NOT in this expand) ==========
-- ALTER TABLE "trips" ALTER COLUMN "tripType" SET NOT NULL;
-- (Do not enable until backfill verified and clients write tripType.)
