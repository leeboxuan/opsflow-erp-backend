ALTER TABLE "master_files"
ADD COLUMN "customerCompanyId" TEXT;

ALTER TABLE "master_files"
ADD CONSTRAINT "master_files_customerCompanyId_fkey"
FOREIGN KEY ("customerCompanyId") REFERENCES "customer_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "master_files_tenantId_type_isActive_idx";
CREATE INDEX "master_files_tenantId_customerCompanyId_type_isActive_idx"
ON "master_files"("tenantId", "customerCompanyId", "type", "isActive");
