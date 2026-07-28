-- CreateTable
CREATE TABLE "warehouse_job_containers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseJobId" TEXT NOT NULL,
    "containerNumber" TEXT,
    "sealNumber" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_job_containers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouse_job_containers_tenantId_warehouseJobId_idx" ON "warehouse_job_containers"("tenantId", "warehouseJobId");

-- CreateIndex
CREATE INDEX "warehouse_job_containers_warehouseJobId_sortOrder_idx" ON "warehouse_job_containers"("warehouseJobId", "sortOrder");

-- AddForeignKey
ALTER TABLE "warehouse_job_containers" ADD CONSTRAINT "warehouse_job_containers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_containers" ADD CONSTRAINT "warehouse_job_containers_warehouseJobId_fkey" FOREIGN KEY ("warehouseJobId") REFERENCES "warehouse_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing single-container fields into rows
INSERT INTO "warehouse_job_containers" (
  "id",
  "tenantId",
  "warehouseJobId",
  "containerNumber",
  "sealNumber",
  "notes",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(random()::text || clock_timestamp()::text || j."id"),
  j."tenantId",
  j."id",
  j."containerNumber",
  j."sealNumber",
  j."warehouseNotes",
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "warehouse_jobs" j
WHERE
  (j."containerNumber" IS NOT NULL AND btrim(j."containerNumber") <> '')
  OR (j."sealNumber" IS NOT NULL AND btrim(j."sealNumber") <> '')
  OR (j."warehouseNotes" IS NOT NULL AND btrim(j."warehouseNotes") <> '');
