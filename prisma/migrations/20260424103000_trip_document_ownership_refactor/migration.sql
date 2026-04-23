-- Document ownership refactor:
-- - Job documents are now QUOTATION / OTHER only.
-- - Trip documents own DO/POD assets and generation metadata.
-- - Preserve legacy enum values/data for safety, while remapping known signature rows.

ALTER TYPE "TripDocumentType" ADD VALUE IF NOT EXISTS 'POD_SIGNATURE';

ALTER TABLE "trip_documents"
  ADD COLUMN IF NOT EXISTS "generatedBySystem" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "generatedSource" TEXT,
  ADD COLUMN IF NOT EXISTS "uploadedByNameSnapshot" TEXT;

ALTER TABLE "job_documents"
  ADD COLUMN IF NOT EXISTS "uploadedByNameSnapshot" TEXT;
