-- Invoice integrity: JobCharge provenance, quotation binding, Paid timestamp,
-- and one-active-invoice per JobCharge (not per Job).
-- Additive; no JobCharge provenance backfill.
-- Drops any earlier job-level reservation table if a draft of that design existed.

DROP TABLE IF EXISTS "invoice_job_reservations";

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paidByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceCustomerQuotationId" TEXT;

CREATE INDEX IF NOT EXISTS "invoices_tenantId_paidAt_idx"
  ON "invoices"("tenantId", "paidAt");

CREATE INDEX IF NOT EXISTS "invoices_tenantId_sourceCustomerQuotationId_idx"
  ON "invoices"("tenantId", "sourceCustomerQuotationId");

ALTER TABLE "invoices"
  DROP CONSTRAINT IF EXISTS "invoices_sourceCustomerQuotationId_fkey";

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_sourceCustomerQuotationId_fkey"
  FOREIGN KEY ("sourceCustomerQuotationId") REFERENCES "customer_quotations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoice_line_items"
  ADD COLUMN IF NOT EXISTS "jobChargeId" TEXT;

CREATE INDEX IF NOT EXISTS "invoice_line_items_tenantId_jobChargeId_idx"
  ON "invoice_line_items"("tenantId", "jobChargeId");

ALTER TABLE "invoice_line_items"
  DROP CONSTRAINT IF EXISTS "invoice_line_items_jobChargeId_fkey";

ALTER TABLE "invoice_line_items"
  ADD CONSTRAINT "invoice_line_items_jobChargeId_fkey"
  FOREIGN KEY ("jobChargeId") REFERENCES "job_charges"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "invoice_charge_reservations" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "jobChargeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_charge_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_charge_reservations_tenantId_jobChargeId_key"
  ON "invoice_charge_reservations"("tenantId", "jobChargeId");

CREATE INDEX IF NOT EXISTS "invoice_charge_reservations_tenantId_invoiceId_idx"
  ON "invoice_charge_reservations"("tenantId", "invoiceId");

ALTER TABLE "invoice_charge_reservations"
  DROP CONSTRAINT IF EXISTS "invoice_charge_reservations_tenantId_fkey";
ALTER TABLE "invoice_charge_reservations"
  ADD CONSTRAINT "invoice_charge_reservations_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_charge_reservations"
  DROP CONSTRAINT IF EXISTS "invoice_charge_reservations_invoiceId_fkey";
ALTER TABLE "invoice_charge_reservations"
  ADD CONSTRAINT "invoice_charge_reservations_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoice_charge_reservations"
  DROP CONSTRAINT IF EXISTS "invoice_charge_reservations_jobChargeId_fkey";
ALTER TABLE "invoice_charge_reservations"
  ADD CONSTRAINT "invoice_charge_reservations_jobChargeId_fkey"
  FOREIGN KEY ("jobChargeId") REFERENCES "job_charges"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
