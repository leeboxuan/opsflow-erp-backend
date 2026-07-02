-- AlterTable
ALTER TABLE "warehouse_jobs" ADD COLUMN "customerReference" TEXT,
ADD COLUMN "orderReference" TEXT,
ADD COLUMN "customerInitial" TEXT,
ADD COLUMN "creatorInitial" TEXT,
ADD COLUMN "customerReferenceSeq" INTEGER,
ADD COLUMN "receivingVessel" TEXT,
ADD COLUMN "placeOfDelivery" TEXT,
ADD COLUMN "destinationCountry" TEXT DEFAULT 'Singapore',
ADD COLUMN "arrivalDate" TIMESTAMP(3),
ADD COLUMN "departureDate" TIMESTAMP(3),
ADD COLUMN "generateDeliveryOrder" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "deliveryOrderGeneratedAt" TIMESTAMP(3),
ADD COLUMN "deliveryOrderDocumentId" TEXT;

-- CreateTable
CREATE TABLE "warehouse_job_customer_ref_counters" (
    "tenantId" TEXT NOT NULL,
    "yy" TEXT NOT NULL,
    "customerInitial" TEXT NOT NULL,
    "nextSeq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_job_customer_ref_counters_pkey" PRIMARY KEY ("tenantId","yy","customerInitial")
);

-- CreateTable
CREATE TABLE "warehouse_job_cargo_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseJobId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "vesselName" TEXT,
    "poNumber" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "totalWeightKg" DECIMAL(12,3),
    "lengthCm" DECIMAL(10,2),
    "widthCm" DECIMAL(10,2),
    "heightCm" DECIMAL(10,2),
    "unitType" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_job_cargo_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warehouse_job_customer_ref_counters_tenantId_idx" ON "warehouse_job_customer_ref_counters"("tenantId");

-- CreateIndex
CREATE INDEX "warehouse_job_cargo_lines_tenantId_warehouseJobId_idx" ON "warehouse_job_cargo_lines"("tenantId", "warehouseJobId");

-- CreateIndex
CREATE INDEX "warehouse_job_cargo_lines_warehouseJobId_sortOrder_idx" ON "warehouse_job_cargo_lines"("warehouseJobId", "sortOrder");

-- AddForeignKey
ALTER TABLE "warehouse_job_customer_ref_counters" ADD CONSTRAINT "warehouse_job_customer_ref_counters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_cargo_lines" ADD CONSTRAINT "warehouse_job_cargo_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouse_job_cargo_lines" ADD CONSTRAINT "warehouse_job_cargo_lines_warehouseJobId_fkey" FOREIGN KEY ("warehouseJobId") REFERENCES "warehouse_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
