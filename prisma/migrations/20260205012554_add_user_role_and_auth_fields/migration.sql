/*
  Warnings:

  - You are about to drop the column `driverUserId` on the `driver_wallet_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `contactName` on the `transport_orders` table. All the data in the column will be lost.
  - You are about to drop the column `contactPhone` on the `transport_orders` table. All the data in the column will be lost.
  - You are about to drop the column `doNumber` on the `transport_orders` table. All the data in the column will be lost.
  - You are about to drop the column `assignedDriverId` on the `trips` table. All the data in the column will be lost.
  - You are about to drop the column `assignedVehicleId` on the `trips` table. All the data in the column will be lost.
  - You are about to drop the column `trailerNo` on the `trips` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `users` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `vehicles` table. All the data in the column will be lost.
  - You are about to drop the `driver_location_latest` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[tripId,transportOrderId]` on the table `driver_wallet_transactions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,transportOrderId]` on the table `stops` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenantId,orderRef]` on the table `transport_orders` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `driverId` to the `driver_wallet_transactions` table without a default value. This is not possible if the table is not empty.
  - Added the required column `orderRef` to the `transport_orders` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DoStatus" AS ENUM ('PENDING', 'SIGNED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPERADMIN', 'USER');

-- DropForeignKey
ALTER TABLE "driver_location_latest" DROP CONSTRAINT "driver_location_latest_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "driver_wallet_transactions" DROP CONSTRAINT "driver_wallet_transactions_tripId_fkey";

-- DropForeignKey
ALTER TABLE "trips" DROP CONSTRAINT "trips_assignedVehicleId_fkey";

-- DropIndex
DROP INDEX "driver_wallet_transactions_tenantId_driverUserId_createdAt_idx";

-- DropIndex
DROP INDEX "driver_wallet_transactions_tenantId_driverUserId_idx";

-- DropIndex
DROP INDEX "stops_tenantId_transportOrderId_idx";

-- DropIndex
DROP INDEX "trips_tenantId_assignedDriverId_idx";

-- AlterTable
ALTER TABLE "driver_wallet_transactions" DROP COLUMN "driverUserId",
ADD COLUMN     "driverId" TEXT NOT NULL,
ADD COLUMN     "stopId" TEXT,
ADD COLUMN     "transportOrderId" TEXT,
ALTER COLUMN "tripId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "pods" ADD COLUMN     "photoKeys" JSONB;

-- AlterTable
ALTER TABLE "stops" ALTER COLUMN "tripId" DROP NOT NULL,
ALTER COLUMN "sequence" DROP NOT NULL;

-- AlterTable
ALTER TABLE "transport_orders" DROP COLUMN "contactName",
DROP COLUMN "contactPhone",
DROP COLUMN "doNumber",
ADD COLUMN     "doDocumentUrl" TEXT,
ADD COLUMN     "doSignatureUrl" TEXT,
ADD COLUMN     "doSignedAt" TIMESTAMP(3),
ADD COLUMN     "doSignerName" TEXT,
ADD COLUMN     "doStatus" "DoStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "doVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "itemsJson" JSONB,
ADD COLUMN     "orderRef" TEXT NOT NULL,
ALTER COLUMN "priceCents" DROP NOT NULL,
ALTER COLUMN "priceCents" DROP DEFAULT,
ALTER COLUMN "currency" DROP NOT NULL;

-- AlterTable
ALTER TABLE "trips" DROP COLUMN "assignedDriverId",
DROP COLUMN "assignedVehicleId",
DROP COLUMN "trailerNo",
ADD COLUMN     "acceptedTrailerNo" TEXT,
ADD COLUMN     "acceptedVehicleNo" TEXT,
ADD COLUMN     "assignedDriverUserId" TEXT,
ADD COLUMN     "driverId" TEXT,
ADD COLUMN     "routeVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "vehicleId" TEXT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "phone",
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "vehicles" DROP COLUMN "type";

-- DropTable
DROP TABLE "driver_location_latest";

-- CreateTable
CREATE TABLE "driver_wallet_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_wallet_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reference" TEXT,
    "availableQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "globalRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_wallet_entries_driverId_createdAt_idx" ON "driver_wallet_entries"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "driver_wallet_entries_tenantId_driverId_idx" ON "driver_wallet_entries"("tenantId", "driverId");

-- CreateIndex
CREATE INDEX "drivers_tenantId_idx" ON "drivers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_tenantId_email_key" ON "drivers"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_tenantId_userId_key" ON "drivers"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "inventory_items_tenantId_idx" ON "inventory_items"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenantId_sku_key" ON "inventory_items"("tenantId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_userId_key" ON "profiles"("userId");

-- CreateIndex
CREATE INDEX "profiles_userId_idx" ON "profiles"("userId");

-- CreateIndex
CREATE INDEX "driver_wallet_transactions_stopId_idx" ON "driver_wallet_transactions"("stopId");

-- CreateIndex
CREATE INDEX "driver_wallet_transactions_tenantId_driverId_idx" ON "driver_wallet_transactions"("tenantId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "driver_wallet_transactions_tripId_transportOrderId_key" ON "driver_wallet_transactions"("tripId", "transportOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "stops_tenantId_transportOrderId_key" ON "stops"("tenantId", "transportOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "transport_orders_tenantId_orderRef_key" ON "transport_orders"("tenantId", "orderRef");

-- CreateIndex
CREATE INDEX "trips_tenantId_assignedDriverUserId_idx" ON "trips"("tenantId", "assignedDriverUserId");

-- CreateIndex
CREATE INDEX "trips_tenantId_driverId_idx" ON "trips"("tenantId", "driverId");

-- CreateIndex
CREATE INDEX "trips_tenantId_vehicleId_idx" ON "trips"("tenantId", "vehicleId");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_wallet_transactions" ADD CONSTRAINT "driver_wallet_transactions_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_wallet_transactions" ADD CONSTRAINT "driver_wallet_transactions_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_wallet_transactions" ADD CONSTRAINT "driver_wallet_transactions_transportOrderId_fkey" FOREIGN KEY ("transportOrderId") REFERENCES "transport_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_wallet_transactions" ADD CONSTRAINT "driver_wallet_transactions_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_wallet_entries" ADD CONSTRAINT "driver_wallet_entries_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_wallet_entries" ADD CONSTRAINT "driver_wallet_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
