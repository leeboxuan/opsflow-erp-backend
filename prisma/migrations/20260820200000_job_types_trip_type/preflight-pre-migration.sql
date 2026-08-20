-- Phase 4 REQUIRED pre-migration preflight (SOURCE ONLY — DO NOT EXECUTE from agents).
-- Runs against the UNTOUCHED pre-Phase-4 schema.
-- Executable statements below reference only existing jobs/trips/tenants objects.
-- Safe order: run this → apply 20260820200000 migration → optional post-expand diagnostic.

-- Legacy job type distribution
SELECT "jobType"::text AS job_type, COUNT(*)::bigint AS n
FROM "jobs"
GROUP BY 1
ORDER BY 1;

-- Jobs with null legacy type (unexpected if column was NOT NULL historically)
SELECT COUNT(*)::bigint AS jobs_null_legacy_type
FROM "jobs"
WHERE "jobType" IS NULL;

-- Jobs with invalid / unexpected legacy type tokens (defensive; enum normally prevents this)
SELECT COUNT(*)::bigint AS jobs_invalid_legacy_type
FROM "jobs"
WHERE "jobType" IS NOT NULL
  AND "jobType"::text NOT IN ('LCL', 'IMPORT', 'EXPORT', 'COLLECTION');

-- Job trips without a tenant-matched parent job
SELECT COUNT(*)::bigint AS trips_orphan_or_cross_tenant_parent
FROM "trips" t
LEFT JOIN "jobs" j ON j."id" = t."jobId" AND j."tenantId" = t."tenantId"
WHERE t."jobId" IS NOT NULL
  AND j."id" IS NULL;

-- Trips that cannot inherit a valid legacy parent type (orphan OR parent null type)
SELECT COUNT(*)::bigint AS trips_cannot_inherit_legacy_type
FROM "trips" t
LEFT JOIN "jobs" j ON j."id" = t."jobId" AND j."tenantId" = t."tenantId"
WHERE t."jobId" IS NOT NULL
  AND (j."id" IS NULL OR j."jobType" IS NULL);

-- Tenant integrity: jobs whose tenantId is missing from tenants
SELECT COUNT(*)::bigint AS jobs_missing_tenant
FROM "jobs" j
LEFT JOIN "tenants" tn ON tn."id" = j."tenantId"
WHERE tn."id" IS NULL;

-- Tenant integrity: trips whose tenantId is missing from tenants
SELECT COUNT(*)::bigint AS trips_missing_tenant
FROM "trips" t
LEFT JOIN "tenants" tn ON tn."id" = t."tenantId"
WHERE tn."id" IS NULL;
