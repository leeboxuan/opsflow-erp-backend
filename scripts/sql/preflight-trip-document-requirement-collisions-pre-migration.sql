-- READ-ONLY PRE-MIGRATION collision preflight for Phase 1 trip document requirements.
--
-- EXECUTION POINT: BEFORE applying either
--   20260820170000_trip_document_requirement_stage_uploader_permit
--   or
--   20260820180000_trip_document_requirement_unique_tenant_trip_type_stage
--
-- Why this key: migration 20260820170000 adds requirementStage NOT NULL DEFAULT
-- 'BEFORE_COMPLETE'. Every existing row therefore receives BEFORE_COMPLETE, so
-- pre-migration collisions that would break the later unique index
-- (tenantId, tripId, type, requirementStage) are exactly the groups that
-- already collide on (tenantId, tripId, type).
--
-- This file MUST NOT reference requirementStage, responsibleUploader, PERMIT,
-- or any other column/type introduced by Phase 1.
--
-- Operator-runnable only. Do not execute from agent workflows against
-- production, UAT, or other external databases. Do not delete or rewrite rows.
-- If any query returns rows: STOP. Resolve via a separately reviewed
-- data-remediation plan before migrate deploy.

-- 1) Duplicate groups (implied stage BEFORE_COMPLETE)
SELECT
  r."tenantId" AS tenant_id,
  t."jobId" AS job_id,
  r."tripId" AS trip_id,
  r."type" AS document_type,
  'BEFORE_COMPLETE'::text AS implied_requirement_stage,
  COUNT(*)::int AS duplicate_count,
  array_agg(r.id ORDER BY r."createdAt" ASC, r.id ASC) AS requirement_ids,
  array_agg(r.label ORDER BY r."createdAt" ASC, r.id ASC) AS labels,
  array_agg(r."isRequired" ORDER BY r."createdAt" ASC, r.id ASC) AS is_required_flags,
  array_agg(r."requiresSignature" ORDER BY r."createdAt" ASC, r.id ASC) AS requires_signature_flags,
  array_agg(r."minCount" ORDER BY r."createdAt" ASC, r.id ASC) AS min_counts,
  array_agg(r."sortOrder" ORDER BY r."createdAt" ASC, r.id ASC) AS sort_orders,
  array_agg(r."createdAt" ORDER BY r."createdAt" ASC, r.id ASC) AS created_ats,
  array_agg(r."updatedAt" ORDER BY r."createdAt" ASC, r.id ASC) AS updated_ats
FROM "trip_document_requirements" r
LEFT JOIN "trips" t
  ON t.id = r."tripId"
GROUP BY
  r."tenantId",
  t."jobId",
  r."tripId",
  r."type"
HAVING COUNT(*) > 1
ORDER BY
  r."tenantId" ASC,
  t."jobId" ASC NULLS LAST,
  r."tripId" ASC,
  r."type" ASC;

-- 2) Affected row detail for each colliding group
WITH collisions AS (
  SELECT
    r."tenantId",
    r."tripId",
    r."type"
  FROM "trip_document_requirements" r
  GROUP BY
    r."tenantId",
    r."tripId",
    r."type"
  HAVING COUNT(*) > 1
)
SELECT
  r.id AS requirement_id,
  r."tenantId" AS tenant_id,
  t."jobId" AS job_id,
  r."tripId" AS trip_id,
  r."type" AS document_type,
  'BEFORE_COMPLETE'::text AS implied_requirement_stage,
  r.label,
  r."isRequired" AS is_required,
  r."requiresSignature" AS requires_signature,
  r."minCount" AS min_count,
  r."sortOrder" AS sort_order,
  r."createdAt" AS created_at,
  r."updatedAt" AS updated_at
FROM "trip_document_requirements" r
INNER JOIN collisions c
  ON c."tenantId" = r."tenantId"
 AND c."tripId" = r."tripId"
 AND c."type" = r."type"
LEFT JOIN "trips" t
  ON t.id = r."tripId"
ORDER BY
  r."tenantId" ASC,
  t."jobId" ASC NULLS LAST,
  r."tripId" ASC,
  r."type" ASC,
  r."createdAt" ASC,
  r.id ASC;
