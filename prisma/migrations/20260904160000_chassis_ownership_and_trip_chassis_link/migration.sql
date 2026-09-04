-- Additive: chassis ownership + optional trip chassis link.
-- Existing chassis rows default to company-owned (isBorrowed=false, borrowedFromCompany=NULL).
-- Existing trips keep trailerNumber text; chassisId remains NULL until a controlled selection.

-- AlterTable
ALTER TABLE "chassis" ADD COLUMN "isBorrowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "chassis" ADD COLUMN "borrowedFromCompany" TEXT;

-- CreateIndex
CREATE INDEX "chassis_tenantId_isBorrowed_idx" ON "chassis"("tenantId", "isBorrowed");

-- AlterTable
ALTER TABLE "trips" ADD COLUMN "chassisId" TEXT;

-- CreateIndex
CREATE INDEX "trips_tenantId_chassisId_idx" ON "trips"("tenantId", "chassisId");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_chassisId_fkey" FOREIGN KEY ("chassisId") REFERENCES "chassis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
