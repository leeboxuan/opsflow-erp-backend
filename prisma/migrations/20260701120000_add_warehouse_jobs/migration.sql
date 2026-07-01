-- CreateEnum
CREATE TYPE "WarehouseJobType" AS ENUM ('RECEIVE', 'PUTAWAY', 'PICK', 'PACK', 'STOCK_ADJUSTMENT', 'RETURN_PROCESSING', 'INTERNAL_MOVE', 'CYCLE_COUNT');

-- CreateEnum
CREATE TYPE "WarehouseJobStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WarehouseJobPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "WarehouseJobUnitLinkStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'RELEASED');

-- CreateEnum
CREATE TYPE "WarehouseJobEventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'LINE_ADDED', 'LINE_UPDATED', 'LINE_REMOVED', 'UNIT_LINKED', 'UNIT_CONFIRMED', 'UNIT_RELEASED', 'ASSIGNED', 'NOTE_ADDED', 'CANCELLED', 'COMPLETED');

-- CreateTable
CREATE TABLE "warehouse_job_internal_ref_counters" (
    "tenantId" TEXT NOT NULL,
    "yyyymm" TEXT NOT NULL,
    "nextSeq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_job_internal_ref_counters_pkey" PRIMARY KEY ("tenantId","yyyymm")
);

-- CreateTable
CREATE TABLE "warehouse_jobs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "internalRef" TEXT NOT NULL,
    "type" "WarehouseJobType" NOT NULL,
    "status" "WarehouseJobStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "WarehouseJobPriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "customerCompanyId" TEXT,
    "inventoryBatchId" TEXT,
    "assignedToUserId" TEXT,
    "createdByUserId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "externalRefType" TEXT,
    "externalRefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_job_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseJobId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "inventoryBatchId" TEXT,
    "description" TEXT,
    "requestedQty" INTEGER NOT NULL DEFAULT 0,
    "completedQty" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_job_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_job_units" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseJobId" TEXT NOT NULL,
    "warehouseJobLineId" TEXT,
    "inventoryUnitId" TEXT NOT NULL,
    "linkStatus" "WarehouseJobUnitLinkStatus" NOT NULL DEFAULT 'PLANNED',
    "scannedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_job_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouse_job_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseJobId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "eventType" "WarehouseJobEventType" NOT NULL,
    "fromStatus" "WarehouseJobStatus",
    "toStatus" "WarehouseJobStatus",
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warehouse_job_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouse_job_internal_ref_counters_tenantId_idx" ON "warehouse_job_internal_ref_counters"("tenantId");

-- CreateIndex
CREATE INDEX "warehouse_jobs_tenantId_status_idx" ON "warehouse_jobs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "warehouse_jobs_tenantId_type_idx" ON "warehouse_jobs"("tenantId", "type");

-- CreateIndex
CREATE INDEX "warehouse_jobs_tenantId_priority_idx" ON "warehouse_jobs"("tenantId", "priority");

-- CreateIndex
CREATE INDEX "warehouse_jobs_tenantId_customerCompanyId_idx" ON "warehouse_jobs"("tenantId", "customerCompanyId");

-- CreateIndex
CREATE INDEX "warehouse_jobs_tenantId_inventoryBatchId_idx" ON "warehouse_jobs"("tenantId", "inventoryBatchId");

-- CreateIndex
CREATE INDEX "warehouse_jobs_tenantId_assignedToUserId_idx" ON "warehouse_jobs"("tenantId", "assignedToUserId");

-- CreateIndex
CREATE INDEX "warehouse_jobs_tenantId_createdAt_idx" ON "warehouse_jobs"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "warehouse_jobs_tenantId_externalRefType_externalRefId_idx" ON "warehouse_jobs"("tenantId", "externalRefType", "externalRefId");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_jobs_tenantId_internalRef_key" ON "warehouse_jobs"("tenantId", "internalRef");

-- CreateIndex
CREATE INDEX "warehouse_job_lines_tenantId_warehouseJobId_idx" ON "warehouse_job_lines"("tenantId", "warehouseJobId");

-- CreateIndex
CREATE INDEX "warehouse_job_lines_tenantId_inventoryItemId_idx" ON "warehouse_job_lines"("tenantId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "warehouse_job_lines_tenantId_inventoryBatchId_idx" ON "warehouse_job_lines"("tenantId", "inventoryBatchId");

-- CreateIndex
CREATE INDEX "warehouse_job_lines_warehouseJobId_sortOrder_idx" ON "warehouse_job_lines"("warehouseJobId", "sortOrder");

-- CreateIndex
CREATE INDEX "warehouse_job_units_tenantId_warehouseJobId_idx" ON "warehouse_job_units"("tenantId", "warehouseJobId");

-- CreateIndex
CREATE INDEX "warehouse_job_units_tenantId_warehouseJobLineId_idx" ON "warehouse_job_units"("tenantId", "warehouseJobLineId");

-- CreateIndex
CREATE INDEX "warehouse_job_units_tenantId_inventoryUnitId_idx" ON "warehouse_job_units"("tenantId", "inventoryUnitId");

-- CreateIndex
CREATE INDEX "warehouse_job_units_tenantId_linkStatus_idx" ON "warehouse_job_units"("tenantId", "linkStatus");

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_job_units_tenantId_warehouseJobId_inventoryUnitId_key" ON "warehouse_job_units"("tenantId", "warehouseJobId", "inventoryUnitId");

-- CreateIndex
CREATE INDEX "warehouse_job_events_tenantId_warehouseJobId_createdAt_idx" ON "warehouse_job_events"("tenantId", "warehouseJobId", "createdAt");

-- CreateIndex
CREATE INDEX "warehouse_job_events_tenantId_eventType_idx" ON "warehouse_job_events"("tenantId", "eventType");

-- CreateIndex
CREATE INDEX "warehouse_job_events_tenantId_actorUserId_idx" ON "warehouse_job_events"("tenantId", "actorUserId");

-- AddForeignKey
ALTER TABLE "warehouse_job_internal_ref_counters" ADD CONSTRAINT "warehouse_job_internal_ref_counters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_jobs" ADD CONSTRAINT "warehouse_jobs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_jobs" ADD CONSTRAINT "warehouse_jobs_customerCompanyId_fkey" FOREIGN KEY ("customerCompanyId") REFERENCES "customer_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_jobs" ADD CONSTRAINT "warehouse_jobs_inventoryBatchId_fkey" FOREIGN KEY ("inventoryBatchId") REFERENCES "inventory_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_jobs" ADD CONSTRAINT "warehouse_jobs_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_jobs" ADD CONSTRAINT "warehouse_jobs_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_lines" ADD CONSTRAINT "warehouse_job_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_lines" ADD CONSTRAINT "warehouse_job_lines_warehouseJobId_fkey" FOREIGN KEY ("warehouseJobId") REFERENCES "warehouse_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_lines" ADD CONSTRAINT "warehouse_job_lines_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_lines" ADD CONSTRAINT "warehouse_job_lines_inventoryBatchId_fkey" FOREIGN KEY ("inventoryBatchId") REFERENCES "inventory_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_units" ADD CONSTRAINT "warehouse_job_units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_units" ADD CONSTRAINT "warehouse_job_units_warehouseJobId_fkey" FOREIGN KEY ("warehouseJobId") REFERENCES "warehouse_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_units" ADD CONSTRAINT "warehouse_job_units_warehouseJobLineId_fkey" FOREIGN KEY ("warehouseJobLineId") REFERENCES "warehouse_job_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_units" ADD CONSTRAINT "warehouse_job_units_inventoryUnitId_fkey" FOREIGN KEY ("inventoryUnitId") REFERENCES "inventory_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_events" ADD CONSTRAINT "warehouse_job_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_events" ADD CONSTRAINT "warehouse_job_events_warehouseJobId_fkey" FOREIGN KEY ("warehouseJobId") REFERENCES "warehouse_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_events" ADD CONSTRAINT "warehouse_job_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
