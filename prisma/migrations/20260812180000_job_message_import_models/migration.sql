-- Job message import models (additive)
-- Preview/review records only. Does not alter canonical jobs/trips.

CREATE TYPE "JobMessageImportBatchStatus" AS ENUM ('IN_REVIEW', 'CONFIRMED', 'CANCELLED');
CREATE TYPE "JobMessageImportSourceChannel" AS ENUM ('WHATSAPP');
CREATE TYPE "JobMessageImportParserErrorSeverity" AS ENUM ('INFO', 'WARNING');
CREATE TYPE "JobMessageImportDraftValidationStatus" AS ENUM ('READY', 'NEEDS_REVIEW', 'POSSIBLE_DUPLICATE');
CREATE TYPE "JobMessageImportDraftInclusionState" AS ENUM ('INCLUDED', 'EXCLUDED');
CREATE TYPE "JobMessageImportMovementType" AS ENUM ('COLLECTION', 'IMPORT', 'EXPORT', 'LCL', 'UNKNOWN');

CREATE TABLE "job_message_import_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "status" "JobMessageImportBatchStatus" NOT NULL DEFAULT 'IN_REVIEW',
    "sourceChannel" "JobMessageImportSourceChannel" NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "modelName" TEXT,
    "parserVersionNo" INTEGER,
    "batchWarningsJson" JSONB,
    "parseMetadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "job_message_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_message_import_batches_tenantId_status_idx" ON "job_message_import_batches" ("tenantId", "status");
CREATE INDEX "job_message_import_batches_tenantId_createdAt_idx" ON "job_message_import_batches" ("tenantId", "createdAt");
-- Non-unique lookup for fingerprint history (including CONFIRMED batches).
CREATE INDEX "job_message_import_batches_tenantId_sourceFingerprint_idx" ON "job_message_import_batches" ("tenantId", "sourceFingerprint");
-- Partial unique: at most one IN_REVIEW batch per tenant+fingerprint.
-- Confirmed/cancelled rows are excluded, so a later import of the same source is allowed.
CREATE UNIQUE INDEX "job_message_import_batches_tenantId_sourceFingerprint_in_review_key" ON "job_message_import_batches" ("tenantId", "sourceFingerprint") WHERE "status" = 'IN_REVIEW';

CREATE TABLE "job_message_import_drafts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "clientDraftId" TEXT NOT NULL,
    "movementType" "JobMessageImportMovementType" NOT NULL,
    "sourceFragment" TEXT NOT NULL,
    "duplicateFingerprint" TEXT NOT NULL,
    "validationStatus" "JobMessageImportDraftValidationStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "inclusionState" "JobMessageImportDraftInclusionState" NOT NULL DEFAULT 'INCLUDED',
    "parsedJson" JSONB NOT NULL,
    "controllerJson" JSONB,
    "fieldEvidenceJson" JSONB,
    "draftWarningsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,
    "canonicalJobId" TEXT,
    "duplicateOverrideReason" TEXT,
    "duplicateOverrideActorUserId" TEXT,
    "duplicateOverrideAt" TIMESTAMP(3),

    CONSTRAINT "job_message_import_drafts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "job_message_import_drafts_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "job_message_import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "job_message_import_drafts_tenantId_batchId_clientDraftId_key" ON "job_message_import_drafts" ("tenantId", "batchId", "clientDraftId");
CREATE INDEX "job_message_import_drafts_tenantId_batchId_validationStatus_idx" ON "job_message_import_drafts" ("tenantId", "batchId", "validationStatus");
CREATE INDEX "job_message_import_drafts_tenantId_batchId_inclusionState_idx" ON "job_message_import_drafts" ("tenantId", "batchId", "inclusionState");
CREATE INDEX "job_message_import_drafts_tenantId_duplicateFingerprint_idx" ON "job_message_import_drafts" ("tenantId", "duplicateFingerprint");
