-- Unique constraint for Phase 1 document requirements.
-- Canonical duplicate key: tenantId + tripId + type + requirementStage.
--
-- This migration fails safely when collisions exist: PostgreSQL rejects
-- CREATE UNIQUE INDEX if any duplicate groups remain.
--
-- REQUIRED GATE (before either Phase 1 migration, including 20260820170000):
--   scripts/sql/preflight-trip-document-requirement-collisions-pre-migration.sql
-- OPTIONAL POST-COLUMN / PRE-INDEX diagnostic (only after 20260820170000):
--   ./preflight.sql in this folder
--
-- Do not auto-delete rows. Do not apply until collision preflight is clean.
-- Full order: prisma/migrations/README-phase1-trip-document-requirements.md

CREATE UNIQUE INDEX "trip_document_requirements_tenant_trip_type_stage_key"
  ON "trip_document_requirements" ("tenantId", "tripId", "type", "requirementStage");
