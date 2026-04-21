-- Generic customer-company documents (separate from quotation workflow)
CREATE TYPE "CustomerCompanyDocumentType" AS ENUM ('CUSTOMER_DOCUMENT');

CREATE TYPE "CustomerCompanyDocumentStatus" AS ENUM ('ACTIVE', 'DELETED');

CREATE TABLE "customer_company_documents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerCompanyId" TEXT NOT NULL,
    "type" "CustomerCompanyDocumentType" NOT NULL DEFAULT 'CUSTOMER_DOCUMENT',
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "uploadedByUserId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CustomerCompanyDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_company_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_company_documents_tenantId_customerCompanyId_status_up_idx"
ON "customer_company_documents"("tenantId", "customerCompanyId", "status", "uploadedAt");

CREATE INDEX "customer_company_documents_tenantId_customerCompanyId_type_idx"
ON "customer_company_documents"("tenantId", "customerCompanyId", "type");

ALTER TABLE "customer_company_documents"
ADD CONSTRAINT "customer_company_documents_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_company_documents"
ADD CONSTRAINT "customer_company_documents_customerCompanyId_fkey"
FOREIGN KEY ("customerCompanyId") REFERENCES "customer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_company_documents"
ADD CONSTRAINT "customer_company_documents_uploadedByUserId_fkey"
FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
