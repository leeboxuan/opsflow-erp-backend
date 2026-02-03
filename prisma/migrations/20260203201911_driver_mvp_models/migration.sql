-- CreateEnum
CREATE TYPE "StopStatus" AS ENUM ('Pending', 'InProgress', 'Completed');

-- AlterTable
ALTER TABLE "stops" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" "StopStatus" NOT NULL DEFAULT 'Pending';

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "trailerNo" TEXT;

-- CreateTable
CREATE TABLE "pod_photo_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stopId" TEXT NOT NULL,
    "photoKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pod_photo_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_wallet_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driverUserId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "type" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_wallet_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pod_photo_documents_tenantId_stopId_idx" ON "pod_photo_documents"("tenantId", "stopId");

-- CreateIndex
CREATE INDEX "driver_wallet_transactions_tenantId_driverUserId_idx" ON "driver_wallet_transactions"("tenantId", "driverUserId");

-- CreateIndex
CREATE INDEX "driver_wallet_transactions_tenantId_driverUserId_createdAt_idx" ON "driver_wallet_transactions"("tenantId", "driverUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "pod_photo_documents" ADD CONSTRAINT "pod_photo_documents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pod_photo_documents" ADD CONSTRAINT "pod_photo_documents_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_wallet_transactions" ADD CONSTRAINT "driver_wallet_transactions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_wallet_transactions" ADD CONSTRAINT "driver_wallet_transactions_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
