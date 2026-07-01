-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'WAREHOUSE';

-- AlterEnum
ALTER TYPE "WarehouseJobEventType" ADD VALUE 'DOCUMENT_UPLOADED';
ALTER TYPE "WarehouseJobEventType" ADD VALUE 'DOCUMENT_UPDATED';
ALTER TYPE "WarehouseJobEventType" ADD VALUE 'DOCUMENT_DELETED';
ALTER TYPE "WarehouseJobEventType" ADD VALUE 'DOCUMENT_APPROVED';
ALTER TYPE "WarehouseJobEventType" ADD VALUE 'DOCUMENT_REJECTED';
ALTER TYPE "WarehouseJobEventType" ADD VALUE 'EXECUTION_UPDATED';

-- CreateEnum
CREATE TYPE "WarehouseJobDocumentType" AS ENUM ('PACKING_LIST', 'DELIVERY_ORDER', 'INSTRUCTION', 'REFERENCE_PHOTO', 'WAREHOUSE_PHOTO', 'DAMAGE_PHOTO', 'COMPLETION_PHOTO', 'OTHER');

-- CreateEnum
CREATE TYPE "WarehouseJobDocumentSource" AS ENUM ('ADMIN', 'OPS', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "WarehouseJobDocumentReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "warehouse_jobs" ADD COLUMN "containerNumber" TEXT,
ADD COLUMN "sealNumber" TEXT,
ADD COLUMN "warehouseNotes" TEXT;

-- CreateTable
CREATE TABLE "warehouse_job_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseJobId" TEXT NOT NULL,
    "uploadedByUserId" TEXT,
    "type" "WarehouseJobDocumentType" NOT NULL,
    "source" "WarehouseJobDocumentSource" NOT NULL,
    "reviewStatus" "WarehouseJobDocumentReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "originalName" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "storageKey" TEXT NOT NULL,
    "url" TEXT,
    "notes" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_job_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouse_job_documents_tenantId_warehouseJobId_idx" ON "warehouse_job_documents"("tenantId", "warehouseJobId");

-- CreateIndex
CREATE INDEX "warehouse_job_documents_tenantId_type_idx" ON "warehouse_job_documents"("tenantId", "type");

-- CreateIndex
CREATE INDEX "warehouse_job_documents_tenantId_source_idx" ON "warehouse_job_documents"("tenantId", "source");

-- CreateIndex
CREATE INDEX "warehouse_job_documents_tenantId_reviewStatus_idx" ON "warehouse_job_documents"("tenantId", "reviewStatus");

-- CreateIndex
CREATE INDEX "warehouse_job_documents_tenantId_createdAt_idx" ON "warehouse_job_documents"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "warehouse_job_documents" ADD CONSTRAINT "warehouse_job_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_documents" ADD CONSTRAINT "warehouse_job_documents_warehouseJobId_fkey" FOREIGN KEY ("warehouseJobId") REFERENCES "warehouse_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_documents" ADD CONSTRAINT "warehouse_job_documents_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_documents" ADD CONSTRAINT "warehouse_job_documents_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
