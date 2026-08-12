-- Quotation lifecycle: SIGNED / CANCELLED
DO $$ BEGIN
  ALTER TYPE "CustomerQuotationStatus" ADD VALUE 'SIGNED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "CustomerQuotationStatus" ADD VALUE 'CANCELLED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Customer commercial lifecycle
DO $$ BEGIN
  CREATE TYPE "CustomerCommercialStatus" AS ENUM (
    'PROSPECT',
    'PENDING_COMMERCIAL_APPROVAL',
    'ACTIVE',
    'SUSPENDED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "customer_companies"
  ADD COLUMN IF NOT EXISTS "commercialStatus" "CustomerCommercialStatus" NOT NULL DEFAULT 'PROSPECT';

-- Existing companies keep operational meaning of isActive
UPDATE "customer_companies"
SET "commercialStatus" = CASE
  WHEN "isActive" = false THEN 'SUSPENDED'::"CustomerCommercialStatus"
  ELSE 'ACTIVE'::"CustomerCommercialStatus"
END;

CREATE INDEX IF NOT EXISTS "customer_companies_tenantId_commercialStatus_idx"
  ON "customer_companies"("tenantId", "commercialStatus");

-- Signed customer copy fields (never overwrite generated pdfKey)
ALTER TABLE "customer_quotations"
  ADD COLUMN IF NOT EXISTS "signedDocumentKey" TEXT,
  ADD COLUMN IF NOT EXISTS "signedDocumentOriginalName" TEXT,
  ADD COLUMN IF NOT EXISTS "signedDocumentUploadedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "signedDocumentUploadedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "signedDocumentVersion" INTEGER NOT NULL DEFAULT 0;
