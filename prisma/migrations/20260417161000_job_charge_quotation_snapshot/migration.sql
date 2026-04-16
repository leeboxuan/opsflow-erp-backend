ALTER TABLE "job_charges"
ADD COLUMN "sourceCustomerQuotationItemId" TEXT;

CREATE INDEX "job_charges_tenantId_sourceCustomerQuotationItemId_idx"
ON "job_charges"("tenantId", "sourceCustomerQuotationItemId");
