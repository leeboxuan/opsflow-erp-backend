-- Single current base template per tenant + dataset type
ALTER TABLE "master_rate_datasets"
  ADD COLUMN IF NOT EXISTS "isCurrent" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: prefer ACTIVE with highest versionNo per (tenantId, type)
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "type"
      ORDER BY
        CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
        "versionNo" DESC
    ) AS rn
  FROM "master_rate_datasets"
)
UPDATE "master_rate_datasets" d
SET "isCurrent" = (ranked.rn = 1)
FROM ranked
WHERE d.id = ranked.id;

CREATE INDEX IF NOT EXISTS "master_rate_datasets_tenantId_type_isCurrent_idx"
  ON "master_rate_datasets"("tenantId", "type", "isCurrent");

-- Enforce at most one current template per tenant + type
CREATE UNIQUE INDEX IF NOT EXISTS "master_rate_datasets_one_current_per_type"
  ON "master_rate_datasets"("tenantId", "type")
  WHERE "isCurrent" = true;
