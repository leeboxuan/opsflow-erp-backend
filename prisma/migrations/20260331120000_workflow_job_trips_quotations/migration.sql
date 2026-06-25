-- CreateEnum
CREATE TYPE "JobTripTemplate" AS ENUM ('PICKUP_TO_DELIVERY', 'DELIVERY_TO_DEPOT', 'DEPOT_TO_DELIVERY', 'DELIVERY_TO_PORT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "QuotationVersionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "JobChargeSourceType" AS ENUM ('CUSTOMER_QUOTATION', 'DRIVER_RATE_MASTER', 'DHC_REFERENCE', 'MANUAL');

-- CreateEnum
CREATE TYPE "TripDocumentType" AS ENUM ('POD_PHOTO', 'SIGNATURE', 'OFFLOADING', 'TRAILER_PARKING_PHOTO', 'PICKUP_DO', 'OTHER');

-- CreateEnum
CREATE TYPE "JobDocumentType" AS ENUM ('QUOTATION', 'OTHER');

-- AlterEnum (PostgreSQL: one statement per migration if PG <= 11; safe as separate statements)
ALTER TYPE "JobDocumentType" ADD VALUE 'PICKUP_DO';
ALTER TYPE "JobDocumentType" ADD VALUE 'OFFLOADING';
ALTER TYPE "JobDocumentType" ADD VALUE 'TRAILER_PARKING_PHOTO';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "exportOriginDepotCode" TEXT,
ADD COLUMN     "exportPortCode" TEXT,
ADD COLUMN     "permitReady" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickupPortCode" TEXT,
ADD COLUMN     "portName" TEXT,
ADD COLUMN     "portTerminalCode" TEXT,
ADD COLUMN     "portnetReady" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "psaStorageRentLastDay" TIMESTAMP(3),
ADD COLUMN     "returnLastDay" TIMESTAMP(3),
ADD COLUMN     "returningDepotCode" TEXT,
ADD COLUMN     "vesselEta" TIMESTAMP(3),
ADD COLUMN     "vesselName" TEXT;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "completedByDriverUserId" TEXT,
ADD COLUMN     "completionRuleJson" JSONB,
ADD COLUMN     "driverEarningCents" INTEGER,
ADD COLUMN     "earningLabelSnapshot" TEXT,
ADD COLUMN     "earningRateMasterId" TEXT,
ADD COLUMN     "jobId" TEXT,
ADD COLUMN     "jobSequence" INTEGER,
ADD COLUMN     "jobTripTemplate" "JobTripTemplate",
ADD COLUMN     "startedByDriverUserId" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "trailerLastLocationCode" TEXT,
ADD COLUMN     "trailerNumber" TEXT;

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "coeExpiryDate" TIMESTAMP(3),
ADD COLUMN     "lastServicingDate" TIMESTAMP(3),
ADD COLUMN     "roadTaxExpiryDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "customer_company_quotations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerCompanyId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "uploadedByUserId" TEXT,
    "effectiveDate" TIMESTAMP(3),
    "status" "QuotationVersionStatus" NOT NULL DEFAULT 'ACTIVE',
    "parsedSummaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_company_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_quotation_rate_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "section" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT,
    "rateCents" INTEGER NOT NULL,
    "containerSize" TEXT,
    "tripMode" TEXT,
    "areaScope" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourceType" TEXT NOT NULL DEFAULT 'PARSER_ANNEX',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_quotation_rate_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_charges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "sourceType" "JobChargeSourceType" NOT NULL,
    "sourceRefId" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "taxCode" TEXT,
    "taxRateBasisPoints" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "selectedByUserId" TEXT,
    "overrideReason" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depot_handling_references" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "depot_handling_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_trip_rate_masters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_trip_rate_masters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "type" "TripDocumentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "uploadedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_singapore_ports" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "master_singapore_ports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_singapore_depots" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "master_singapore_depots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_trailer_locations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "master_trailer_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_company_quotations_tenantId_customerCompanyId_idx" ON "customer_company_quotations"("tenantId", "customerCompanyId");

-- CreateIndex
CREATE INDEX "customer_company_quotations_tenantId_customerCompanyId_stat_idx" ON "customer_company_quotations"("tenantId", "customerCompanyId", "status");

-- CreateIndex
CREATE INDEX "customer_quotation_rate_lines_tenantId_quotationId_idx" ON "customer_quotation_rate_lines"("tenantId", "quotationId");

-- CreateIndex
CREATE INDEX "customer_quotation_rate_lines_tenantId_code_idx" ON "customer_quotation_rate_lines"("tenantId", "code");

-- CreateIndex
CREATE INDEX "job_charges_tenantId_jobId_idx" ON "job_charges"("tenantId", "jobId");

-- CreateIndex
CREATE INDEX "depot_handling_references_tenantId_active_idx" ON "depot_handling_references"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "depot_handling_references_tenantId_code_key" ON "depot_handling_references"("tenantId", "code");

-- CreateIndex
CREATE INDEX "driver_trip_rate_masters_tenantId_active_idx" ON "driver_trip_rate_masters"("tenantId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "driver_trip_rate_masters_tenantId_code_key" ON "driver_trip_rate_masters"("tenantId", "code");

-- CreateIndex
CREATE INDEX "trip_documents_tenantId_tripId_idx" ON "trip_documents"("tenantId", "tripId");

-- CreateIndex
CREATE INDEX "trip_documents_tenantId_type_idx" ON "trip_documents"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "master_singapore_ports_code_key" ON "master_singapore_ports"("code");

-- CreateIndex
CREATE UNIQUE INDEX "master_singapore_depots_code_key" ON "master_singapore_depots"("code");

-- CreateIndex
CREATE UNIQUE INDEX "master_trailer_locations_code_key" ON "master_trailer_locations"("code");

-- CreateIndex
CREATE INDEX "jobs_tenantId_createdByUserId_idx" ON "jobs"("tenantId", "createdByUserId");

-- CreateIndex
CREATE INDEX "trips_tenantId_jobId_idx" ON "trips"("tenantId", "jobId");

-- CreateIndex
CREATE INDEX "trips_tenantId_jobId_jobSequence_idx" ON "trips"("tenantId", "jobId", "jobSequence");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_earningRateMasterId_fkey" FOREIGN KEY ("earningRateMasterId") REFERENCES "driver_trip_rate_masters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_company_quotations" ADD CONSTRAINT "customer_company_quotations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_company_quotations" ADD CONSTRAINT "customer_company_quotations_customerCompanyId_fkey" FOREIGN KEY ("customerCompanyId") REFERENCES "customer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_company_quotations" ADD CONSTRAINT "customer_company_quotations_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_quotation_rate_lines" ADD CONSTRAINT "customer_quotation_rate_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_quotation_rate_lines" ADD CONSTRAINT "customer_quotation_rate_lines_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "customer_company_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_charges" ADD CONSTRAINT "job_charges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_charges" ADD CONSTRAINT "job_charges_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_charges" ADD CONSTRAINT "job_charges_selectedByUserId_fkey" FOREIGN KEY ("selectedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depot_handling_references" ADD CONSTRAINT "depot_handling_references_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_trip_rate_masters" ADD CONSTRAINT "driver_trip_rate_masters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_documents" ADD CONSTRAINT "trip_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_documents" ADD CONSTRAINT "trip_documents_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed global master lists (idempotent)
INSERT INTO "master_singapore_ports" ("id", "code", "name") VALUES
  ('msp_ppap', 'PPAP', 'Pasir Panjang Terminal'),
  ('msp_tuas', 'TUAS', 'Tuas Port'),
  ('msp_brani', 'BRANI', 'Brani Terminal'),
  ('msp_kt', 'KEPPEL', 'Keppel Terminal'),
  ('msp_jurong', 'JURONG', 'Jurong Port'),
  ('msp_sem', 'SEMBAWANG', 'Sembawang Wharves')
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "master_singapore_depots" ("id", "code", "name") VALUES
  ('msd_gul7', 'GUL7', '7 Gul Circle warehouse / yard'),
  ('msd_gul_default', 'GUL_DEFAULT', '7 Gul Circle — default return'),
  ('msd_tuas', 'TUAS_DEPOT', 'Tuas logistics depot (placeholder)'),
  ('msd_pasir', 'PASIR_DEPOT', 'Pasir Panjang area depot (placeholder)')
ON CONFLICT ("code") DO NOTHING;

-- Seven Gul Circle trailer last-location options (controlled list for driver start)
INSERT INTO "master_trailer_locations" ("id", "code", "name") VALUES
  ('mtl_gul_a1', 'GUL_A1', '7 Gul Circle — Bay A1'),
  ('mtl_gul_a2', 'GUL_A2', '7 Gul Circle — Bay A2'),
  ('mtl_gul_b1', 'GUL_B1', '7 Gul Circle — Bay B1'),
  ('mtl_gul_b2', 'GUL_B2', '7 Gul Circle — Bay B2'),
  ('mtl_gul_c1', 'GUL_C1', '7 Gul Circle — Yard C1'),
  ('mtl_gul_c2', 'GUL_C2', '7 Gul Circle — Yard C2'),
  ('mtl_gul_office', 'GUL_OFFICE', '7 Gul Circle — Office / front')
ON CONFLICT ("code") DO NOTHING;
