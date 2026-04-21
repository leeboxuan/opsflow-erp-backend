-- Unified dataset-first master rates architecture (quotation, trucking, dhc)
CREATE TYPE "MasterRateDatasetType" AS ENUM ('QUOTATION', 'TRUCKING_RATES', 'DHC_RATES');
CREATE TYPE "MasterRateDatasetStatus" AS ENUM ('DRAFT', 'ACTIVE');

CREATE TABLE "master_rate_datasets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "MasterRateDatasetType" NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "MasterRateDatasetStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,
    "importedAt" TIMESTAMP(3),
    "importedByUserId" TEXT,
    "sourceFileName" TEXT,
    "activatedAt" TIMESTAMP(3),
    "activatedByUserId" TEXT,
    CONSTRAINT "master_rate_datasets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "master_rate_dataset_rows" (
    "id" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "section" TEXT,
    "description" TEXT,
    "category" TEXT,
    "unit" TEXT,
    "containerSize" TEXT,
    "tripMode" TEXT,
    "areaScope" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "rateCents" INTEGER,
    "rawRateText" TEXT,
    "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false,
    "hasMultipleRates" BOOLEAN NOT NULL DEFAULT false,
    "rateOptionsJson" JSONB,
    "defaultRateOptionIndex" INTEGER,
    "notes" TEXT,
    "sortOrder" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,
    CONSTRAINT "master_rate_dataset_rows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "master_rate_datasets_tenantId_type_versionNo_key"
ON "master_rate_datasets"("tenantId", "type", "versionNo");
CREATE INDEX "master_rate_datasets_tenantId_type_status_idx"
ON "master_rate_datasets"("tenantId", "type", "status");
CREATE INDEX "master_rate_dataset_rows_tenantId_datasetId_idx"
ON "master_rate_dataset_rows"("tenantId", "datasetId");
CREATE INDEX "master_rate_dataset_rows_tenantId_code_idx"
ON "master_rate_dataset_rows"("tenantId", "code");
CREATE INDEX "master_rate_dataset_rows_tenantId_isActive_sortOrder_idx"
ON "master_rate_dataset_rows"("tenantId", "isActive", "sortOrder");

ALTER TABLE "master_rate_datasets"
ADD CONSTRAINT "master_rate_datasets_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "master_rate_dataset_rows"
ADD CONSTRAINT "master_rate_dataset_rows_datasetId_fkey"
FOREIGN KEY ("datasetId") REFERENCES "master_rate_datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "master_rate_dataset_rows"
ADD CONSTRAINT "master_rate_dataset_rows_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
