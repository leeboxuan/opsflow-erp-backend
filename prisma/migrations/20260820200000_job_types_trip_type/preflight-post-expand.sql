-- Phase 4 OPTIONAL post-expand / pre-contract diagnostic (SOURCE ONLY — DO NOT EXECUTE from agents).
-- May reference job_type_assignments and trips.tripType AFTER the expand migration has run.
-- Safe order: preflight-pre-migration.sql → migration.sql → this file → (later) contract NOT NULL.

-- Assignment counts / multi-type jobs
SELECT COUNT(*)::bigint AS assignment_rows FROM "job_type_assignments";

SELECT COUNT(*)::bigint AS jobs_with_multiple_types
FROM (
  SELECT "tenantId", "jobId"
  FROM "job_type_assignments"
  GROUP BY 1, 2
  HAVING COUNT(*) > 1
) x;

-- Duplicate assignment collision risk (should be 0 with unique key)
SELECT "tenantId", "jobId", "jobType", COUNT(*)::bigint AS n
FROM "job_type_assignments"
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1;

-- Trips still missing tripType after backfill
SELECT COUNT(*)::bigint AS trips_null_trip_type
FROM "trips"
WHERE "jobId" IS NOT NULL AND "tripType" IS NULL;

-- Cross-tenant assignment integrity (should be 0 with composite FK)
SELECT COUNT(*)::bigint AS assignments_cross_tenant_job
FROM "job_type_assignments" a
LEFT JOIN "jobs" j ON j."id" = a."jobId" AND j."tenantId" = a."tenantId"
WHERE j."id" IS NULL;

-- Multi-type jobs still holding a non-null compatibility singular (informational after app rollout)
SELECT COUNT(*)::bigint AS multi_type_jobs_with_singular_compat
FROM (
  SELECT a."tenantId", a."jobId"
  FROM "job_type_assignments" a
  GROUP BY 1, 2
  HAVING COUNT(*) > 1
) m
JOIN "jobs" j ON j."id" = m."jobId" AND j."tenantId" = m."tenantId"
WHERE j."jobType" IS NOT NULL;
