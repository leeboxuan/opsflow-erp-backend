-- CreateEnum
CREATE TYPE "InventoryBatchStatus" AS ENUM ('Open', 'Completed', 'Cancelled');

-- CreateEnum
CREATE TYPE "InventoryUnitStatus" AS ENUM ('Available', 'Reserved', 'InTransit', 'Delivered', 'Returned', 'Damaged', 'Cancelled');

-- CreateTable
CREATE TABLE "inventory_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchCode" TEXT NOT NULL,
    "customerName" TEXT,
    "customerRef" TEXT,
    "receivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "status" "InventoryBatchStatus" NOT NULL DEFAULT 'Open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_units" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "unitSku" TEXT NOT NULL,
    "status" "InventoryUnitStatus" NOT NULL DEFAULT 'Available',
    "transportOrderId" TEXT,
    "tripId" TEXT,
    "stopId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_order_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transportOrderId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "batchId" TEXT,
    "qty" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_batches_tenantId_batchCode_key" ON "inventory_batches"("tenantId", "batchCode");

-- CreateIndex
CREATE INDEX "inventory_batches_tenantId_status_idx" ON "inventory_batches"("tenantId", "status");

-- CreateIndex
CREATE INDEX "inventory_batches_tenantId_createdAt_idx" ON "inventory_batches"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_units_tenantId_unitSku_key" ON "inventory_units"("tenantId", "unitSku");

-- CreateIndex
CREATE INDEX "inventory_units_tenantId_inventoryItemId_status_idx" ON "inventory_units"("tenantId", "inventoryItemId", "status");

-- CreateIndex
CREATE INDEX "inventory_units_tenantId_batchId_idx" ON "inventory_units"("tenantId", "batchId");

-- CreateIndex
CREATE INDEX "inventory_units_tenantId_transportOrderId_idx" ON "inventory_units"("tenantId", "transportOrderId");

-- CreateIndex
CREATE INDEX "inventory_units_tenantId_status_idx" ON "inventory_units"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "transport_order_items_transportOrderId_inventoryItemId_key" ON "transport_order_items"("transportOrderId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "transport_order_items_tenantId_transportOrderId_idx" ON "transport_order_items"("tenantId", "transportOrderId");

-- CreateIndex
CREATE INDEX "transport_order_items_tenantId_inventoryItemId_idx" ON "transport_order_items"("tenantId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "transport_order_items_tenantId_batchId_idx" ON "transport_order_items"("tenantId", "batchId");

-- AddForeignKey
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "inventory_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_transportOrderId_fkey" FOREIGN KEY ("transportOrderId") REFERENCES "transport_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_order_items" ADD CONSTRAINT "transport_order_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_order_items" ADD CONSTRAINT "transport_order_items_transportOrderId_fkey" FOREIGN KEY ("transportOrderId") REFERENCES "transport_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_order_items" ADD CONSTRAINT "transport_order_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_order_items" ADD CONSTRAINT "transport_order_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "inventory_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
