-- Additive: permit document type + requirement uploader/stage columns.
-- Existing frozen requirement rows keep their content; new columns get safe defaults.
--
-- SAFE ORDER (see prisma/migrations/README-phase1-trip-document-requirements.md):
-- 1) Run scripts/sql/preflight-trip-document-requirement-collisions-pre-migration.sql
--    against the untouched schema (before this migration).
-- 2) Stop if any collision rows are returned; remediate via reviewed plan only.
-- 3) Optionally run scripts/sql/preflight-trip-document-requirement-snapshots.sql
--    for visibility (absence does not authorize backfill).
-- 4) Apply this migration, then 20260820180000_..._unique_... .
-- Do not auto-delete duplicates or backfill snapshots in these migrations.

ALTER TYPE "TripDocumentType" ADD VALUE 'PERMIT';

CREATE TYPE "TripDocumentResponsibleUploader" AS ENUM ('DRIVER', 'OPERATIONS', 'EITHER');

CREATE TYPE "TripDocumentRequirementStage" AS ENUM (
  'BEFORE_DISPATCH',
  'BEFORE_START',
  'BEFORE_COMPLETE',
  'REFERENCE_ONLY'
);

ALTER TABLE "trip_document_requirements"
  ADD COLUMN "responsibleUploader" "TripDocumentResponsibleUploader" NOT NULL DEFAULT 'DRIVER',
  ADD COLUMN "requirementStage" "TripDocumentRequirementStage" NOT NULL DEFAULT 'BEFORE_COMPLETE';
