-- READ-ONLY preflight: trips lacking TripDocumentRequirement snapshots.
--
-- Operator-runnable only. Do not execute against production, UAT, or any
-- external database from agent workflows. Performs no writes or backfills.
--
-- Reports:
--   summary counts for non-cancelled trips;
--   detail rows for trips with zero requirement snapshot rows.

-- 1) Summary counts (non-cancelled trips)
SELECT
  COUNT(*)::int AS total_non_cancelled_trips,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM "trip_document_requirements" r
      WHERE r."tripId" = t.id
    )
  )::int AS trips_with_requirement_snapshots,
  COUNT(*) FILTER (
    WHERE NOT EXISTS (
      SELECT 1
      FROM "trip_document_requirements" r
      WHERE r."tripId" = t.id
    )
  )::int AS trips_without_requirement_snapshots
FROM "trips" t
WHERE t.status <> 'CANCELLED'::"TripStatus";

-- 2) Trips without snapshots (detail)
SELECT
  t."tenantId" AS tenant_id,
  t."jobId" AS job_id,
  t.id AS trip_id,
  t.status::text AS trip_status,
  t."createdAt" AS created_at
FROM "trips" t
WHERE t.status <> 'CANCELLED'::"TripStatus"
  AND NOT EXISTS (
    SELECT 1
    FROM "trip_document_requirements" r
    WHERE r."tripId" = t.id
  )
ORDER BY
  t."tenantId" ASC,
  t."jobId" ASC NULLS LAST,
  t.id ASC,
  t."createdAt" ASC;
