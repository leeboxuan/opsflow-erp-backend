-- Master file versions for structured upload/parse architecture.
CREATE TYPE "MasterFileType" AS ENUM ('CUSTOMER_QUOTATION', 'DRIVER_PAYOUT', 'DHC_REFERENCE');
CREATE TYPE "MasterFileStatus" AS ENUM ('PARSED', 'PARSE_FAILED', 'SUPERSEDED');

CREATE TABLE "master_files" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "MasterFileType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveDate" TIMESTAMP(3),
    "status" "MasterFileStatus" NOT NULL DEFAULT 'PARSED',
    "parseSummaryJson" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "master_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_quotation_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "masterFileId" TEXT NOT NULL,
    "section" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "containerSize" TEXT,
    "tripMode" TEXT,
    "areaScope" TEXT,
    "unit" TEXT,
    "rateCents" INTEGER NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_quotation_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "driver_payout_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "masterFileId" TEXT NOT NULL,
    "section" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "containerSize" TEXT,
    "tripMode" TEXT,
    "areaScope" TEXT,
    "unit" TEXT,
    "rateCents" INTEGER NOT NULL,
    "notes" TEXT,
    "isSelectableForTripEarning" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "driver_payout_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dhc_reference_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "masterFileId" TEXT NOT NULL,
    "section" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "unit" TEXT,
    "rateCents" INTEGER,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dhc_reference_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "master_files_tenantId_type_isActive_idx" ON "master_files"("tenantId", "type", "isActive");
CREATE INDEX "master_files_tenantId_type_uploadedAt_idx" ON "master_files"("tenantId", "type", "uploadedAt");

CREATE INDEX "customer_quotation_items_tenantId_masterFileId_idx" ON "customer_quotation_items"("tenantId", "masterFileId");
CREATE INDEX "customer_quotation_items_tenantId_active_code_idx" ON "customer_quotation_items"("tenantId", "active", "code");

CREATE INDEX "driver_payout_items_tenantId_masterFileId_idx" ON "driver_payout_items"("tenantId", "masterFileId");
CREATE INDEX "driver_payout_items_tenantId_active_code_idx" ON "driver_payout_items"("tenantId", "active", "code");

CREATE INDEX "dhc_reference_items_tenantId_masterFileId_idx" ON "dhc_reference_items"("tenantId", "masterFileId");
CREATE INDEX "dhc_reference_items_tenantId_active_code_idx" ON "dhc_reference_items"("tenantId", "active", "code");

ALTER TABLE "master_files"
ADD CONSTRAINT "master_files_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "master_files"
ADD CONSTRAINT "master_files_uploadedByUserId_fkey"
FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_quotation_items"
ADD CONSTRAINT "customer_quotation_items_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_quotation_items"
ADD CONSTRAINT "customer_quotation_items_masterFileId_fkey"
FOREIGN KEY ("masterFileId") REFERENCES "master_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "driver_payout_items"
ADD CONSTRAINT "driver_payout_items_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "driver_payout_items"
ADD CONSTRAINT "driver_payout_items_masterFileId_fkey"
FOREIGN KEY ("masterFileId") REFERENCES "master_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dhc_reference_items"
ADD CONSTRAINT "dhc_reference_items_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dhc_reference_items"
ADD CONSTRAINT "dhc_reference_items_masterFileId_fkey"
FOREIGN KEY ("masterFileId") REFERENCES "master_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "trips"
ADD COLUMN "payoutItemId" TEXT;

ALTER TABLE "trips"
ADD CONSTRAINT "trips_payoutItemId_fkey"
FOREIGN KEY ("payoutItemId") REFERENCES "driver_payout_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "trips_tenantId_payoutItemId_idx" ON "trips"("tenantId", "payoutItemId");
