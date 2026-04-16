-- Canonical structured rate master lines per tenant + customer company.
CREATE TABLE "customer_rate_master_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerCompanyId" TEXT NOT NULL,
    "sourceQuotationId" TEXT,
    "section" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "containerSize" TEXT,
    "tripMode" TEXT,
    "areaScope" TEXT,
    "unit" TEXT,
    "rateCents" INTEGER NOT NULL,
    "notes" TEXT,
    "isSelectableForJob" BOOLEAN NOT NULL DEFAULT true,
    "isSelectableForTripEarning" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sourceType" TEXT NOT NULL DEFAULT 'EXCEL_MASTER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_rate_master_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "customer_rate_master_lines_tenantId_customerCompanyId_active_idx"
ON "customer_rate_master_lines"("tenantId", "customerCompanyId", "active");

CREATE INDEX "customer_rate_master_lines_tenantId_customerCompanyId_code_idx"
ON "customer_rate_master_lines"("tenantId", "customerCompanyId", "code");

ALTER TABLE "customer_rate_master_lines"
ADD CONSTRAINT "customer_rate_master_lines_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_rate_master_lines"
ADD CONSTRAINT "customer_rate_master_lines_customerCompanyId_fkey"
FOREIGN KEY ("customerCompanyId") REFERENCES "customer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_rate_master_lines"
ADD CONSTRAINT "customer_rate_master_lines_sourceQuotationId_fkey"
FOREIGN KEY ("sourceQuotationId") REFERENCES "customer_company_quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
