-- Additive commercial provenance: Job ↔ accepted CustomerQuotation,
-- JobCharge ↔ CustomerQuotationLine. Nullable; no backfill.

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "sourceCustomerQuotationId" TEXT;

ALTER TABLE "job_charges"
  ADD COLUMN IF NOT EXISTS "sourceCustomerQuotationLineId" TEXT;

CREATE INDEX IF NOT EXISTS "jobs_tenantId_sourceCustomerQuotationId_idx"
  ON "jobs"("tenantId", "sourceCustomerQuotationId");

CREATE INDEX IF NOT EXISTS "job_charges_tenantId_sourceCustomerQuotationLineId_idx"
  ON "job_charges"("tenantId", "sourceCustomerQuotationLineId");

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_sourceCustomerQuotationId_fkey"
  FOREIGN KEY ("sourceCustomerQuotationId") REFERENCES "customer_quotations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "job_charges"
  ADD CONSTRAINT "job_charges_sourceCustomerQuotationLineId_fkey"
  FOREIGN KEY ("sourceCustomerQuotationLineId") REFERENCES "customer_quotation_lines"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
