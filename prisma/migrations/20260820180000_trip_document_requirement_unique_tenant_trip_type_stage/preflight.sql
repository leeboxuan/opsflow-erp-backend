-- OPTIONAL POST-COLUMN / PRE-INDEX diagnostic only.
--
-- EXECUTION POINT: AFTER 20260820170000_trip_document_requirement_stage_uploader_permit
-- has been applied (requirementStage and responsibleUploader exist), and BEFORE
-- 20260820180000_trip_document_requirement_unique_tenant_trip_type_stage.
--
-- Do NOT run this against a schema that has not yet received the Phase 1 columns.
-- The required gate before either Phase 1 migration is:
--   scripts/sql/preflight-trip-document-requirement-collisions-pre-migration.sql
--
-- Canonical post-column duplicate key: tenantId + tripId + type + requirementStage.
-- Read-only. Do not delete or rewrite rows. Operator-runnable only.

-- 1) Duplicate groups (counts + row IDs)
SELECT
  r."tenantId" AS tenant_id,
  r."tripId" AS trip_id,
  r."type" AS document_type,
  r."requirementStage" AS requirement_stage,
  COUNT(*)::int AS duplicate_count,
  array_agg(r.id ORDER BY r."createdAt" ASC, r.id ASC) AS requirement_ids
FROM "trip_document_requirements" r
GROUP BY
  r."tenantId",
  r."tripId",
  r."type",
  r."requirementStage"
HAVING COUNT(*) > 1
ORDER BY
  r."tenantId" ASC,
  r."tripId" ASC,
  r."type" ASC,
  r."requirementStage" ASC;

-- 2) Affected row detail for each colliding group
WITH collisions AS (
  SELECT
    r."tenantId",
    r."tripId",
    r."type",
    r."requirementStage"
  FROM "trip_document_requirements" r
  GROUP BY
    r."tenantId",
    r."tripId",
    r."type",
    r."requirementStage"
  HAVING COUNT(*) > 1
)
SELECT
  r.id AS requirement_id,
  r."tenantId" AS tenant_id,
  r."tripId" AS trip_id,
  t."jobId" AS job_id,
  r."type" AS document_type,
  r."requirementStage" AS requirement_stage,
  r.label,
  r."isRequired",
  r."minCount",
  r."sortOrder",
  r."createdAt" AS created_at,
  r."updatedAt" AS updated_at
FROM "trip_document_requirements" r
INNER JOIN collisions c
  ON c."tenantId" = r."tenantId"
 AND c."tripId" = r."tripId"
 AND c."type" = r."type"
 AND c."requirementStage" = r."requirementStage"
LEFT JOIN "trips" t
  ON t.id = r."tripId"
ORDER BY
  r."tenantId" ASC,
  r."tripId" ASC,
  r."type" ASC,
  r."requirementStage" ASC,
  r."createdAt" ASC,
  r.id ASC;
