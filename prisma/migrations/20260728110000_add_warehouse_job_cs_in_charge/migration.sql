-- AlterTable
ALTER TABLE "warehouse_jobs" ADD COLUMN "csInChargeUserId" TEXT;

-- CreateIndex
CREATE INDEX "warehouse_jobs_tenantId_csInChargeUserId_idx" ON "warehouse_jobs"("tenantId", "csInChargeUserId");

-- AddForeignKey
ALTER TABLE "warehouse_jobs" ADD CONSTRAINT "warehouse_jobs_csInChargeUserId_fkey" FOREIGN KEY ("csInChargeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
