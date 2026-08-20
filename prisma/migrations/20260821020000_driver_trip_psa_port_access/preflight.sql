-- Read-only preflight for PSA port-access migration.
-- Reports potential conflicts AFTER apply. Does not mutate data.
--
-- Run against target DB with a read-only role when possible.

-- 1) Active trips that require PSA access (after column exists; before apply this returns SQL error — expected).
-- Before apply: skip or expect missing-column error.
-- After expand: counts of PSA-required active trips.

SELECT
  t."tenantId",
  COUNT(*)::int AS active_psa_required_trips
FROM "trips" t
WHERE t."requiresPsaPortAccess" = true
  AND t."status" IN ('DRAFT', 'PUBLISHED', 'ONGOING')
GROUP BY t."tenantId"
ORDER BY active_psa_required_trips DESC;

-- 2) Assigned drivers without PSA access on PSA-required active trips (eligibility conflicts).
SELECT
  t."tenantId",
  t."id" AS "tripId",
  t."jobId",
  t."status",
  t."assignedDriverUserId",
  t."plannedStartAt",
  d."id" AS "driverRowId",
  d."hasPsaPortAccess"
FROM "trips" t
LEFT JOIN "drivers" d
  ON d."tenantId" = t."tenantId"
 AND d."userId" = t."assignedDriverUserId"
WHERE t."requiresPsaPortAccess" = true
  AND t."status" IN ('DRAFT', 'PUBLISHED', 'ONGOING')
  AND t."assignedDriverUserId" IS NOT NULL
  AND COALESCE(d."hasPsaPortAccess", false) = false
ORDER BY t."plannedStartAt" NULLS LAST, t."id";

-- 3) Future conflicting assignments (plannedStartAt >= now, or null planned treated as active).
SELECT
  t."tenantId",
  t."id" AS "tripId",
  t."jobId",
  t."status",
  t."assignedDriverUserId",
  t."plannedStartAt"
FROM "trips" t
LEFT JOIN "drivers" d
  ON d."tenantId" = t."tenantId"
 AND d."userId" = t."assignedDriverUserId"
WHERE t."requiresPsaPortAccess" = true
  AND t."status" IN ('DRAFT', 'PUBLISHED', 'ONGOING')
  AND t."assignedDriverUserId" IS NOT NULL
  AND COALESCE(d."hasPsaPortAccess", false) = false
  AND (t."plannedStartAt" IS NULL OR t."plannedStartAt" >= NOW())
ORDER BY t."plannedStartAt" NULLS FIRST, t."id";
