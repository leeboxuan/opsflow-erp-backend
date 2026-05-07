-- Add invoice metadata support for company documents
ALTER TABLE "customer_company_documents"
ADD COLUMN "generatedByUserId" TEXT,
ADD COLUMN "generatedAt" TIMESTAMP(3),
ADD COLUMN "sourceJobId" TEXT,
ADD COLUMN "sourceInvoiceId" TEXT,
ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Extend customer company document types for generated invoice files
ALTER TYPE "CustomerCompanyDocumentType" ADD VALUE IF NOT EXISTS 'INVOICE';
ALTER TYPE "CustomerCompanyDocumentType" ADD VALUE IF NOT EXISTS 'COMPANY_INVOICE';

-- Add invoice source/template linkage
ALTER TABLE "invoices"
ADD COLUMN "customerCompanyId" TEXT,
ADD COLUMN "sourceJobId" TEXT,
ADD COLUMN "templateCode" TEXT NOT NULL DEFAULT 'DB_WISDOM';

-- Extend invoice line item metadata
ALTER TABLE "invoice_line_items"
ADD COLUMN "sourceType" TEXT,
ADD COLUMN "sourceMasterItemId" TEXT,
ADD COLUMN "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false;
