-- Customer rate templates + structured customer quotations (Phase A+B MVP)
-- Keeps CustomerCompanyQuotation PDF archival unchanged.

CREATE TYPE "CustomerRateTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "CustomerQuotationStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'VOID');
CREATE TYPE "CustomerQuotationAcceptanceMethod" AS ENUM ('EMAIL', 'PORTAL', 'PHONE', 'SIGNED_DOCUMENT', 'OTHER');

CREATE TABLE "customer_rate_templates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerCompanyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CustomerRateTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "sourceMasterDatasetId" TEXT,
    "sourceMasterDatasetVersionNo" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "customer_rate_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_rate_template_rows" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "section" TEXT,
    "description" TEXT,
    "category" TEXT,
    "unit" TEXT,
    "containerSize" TEXT,
    "tripMode" TEXT,
    "areaScope" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "rateCents" INTEGER,
    "rawRateText" TEXT,
    "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false,
    "hasMultipleRates" BOOLEAN NOT NULL DEFAULT false,
    "rateOptionsJson" JSONB,
    "defaultRateOptionIndex" INTEGER,
    "notes" TEXT,
    "sortOrder" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadataJson" JSONB,
    "sourceMasterRowId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "customer_rate_template_rows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_quotations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerCompanyId" TEXT NOT NULL,
    "quotationNo" TEXT NOT NULL,
    "title" TEXT,
    "status" "CustomerQuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "issueDate" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "notes" TEXT,
    "sourceTemplateId" TEXT,
    "sourceTemplateNameSnapshot" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "issuedByUserId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "acceptanceMethod" "CustomerQuotationAcceptanceMethod",
    "acceptanceEvidenceNote" TEXT,
    "acceptanceEvidenceStorageKey" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "customerNameSnapshot" TEXT,
    "pdfKey" TEXT,
    "pdfGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,

    CONSTRAINT "customer_quotations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_quotation_lines" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "unit" TEXT,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SGD',
    "taxCode" TEXT NOT NULL DEFAULT 'SR',
    "taxRate" INTEGER NOT NULL DEFAULT 900,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false,
    "sourceTemplateRowId" TEXT,
    "sourceMasterRowId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_quotation_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotation_no_counters" (
    "tenantId" TEXT NOT NULL,
    "yyyymm" TEXT NOT NULL,
    "nextSeq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotation_no_counters_pkey" PRIMARY KEY ("tenantId","yyyymm")
);

CREATE INDEX "customer_rate_templates_tenantId_customerCompanyId_idx" ON "customer_rate_templates"("tenantId", "customerCompanyId");
CREATE INDEX "customer_rate_templates_tenantId_customerCompanyId_status_idx" ON "customer_rate_templates"("tenantId", "customerCompanyId", "status");

CREATE INDEX "customer_rate_template_rows_tenantId_templateId_idx" ON "customer_rate_template_rows"("tenantId", "templateId");
CREATE INDEX "customer_rate_template_rows_tenantId_code_idx" ON "customer_rate_template_rows"("tenantId", "code");
CREATE INDEX "customer_rate_template_rows_tenantId_isActive_sortOrder_idx" ON "customer_rate_template_rows"("tenantId", "isActive", "sortOrder");

CREATE UNIQUE INDEX "customer_quotations_tenantId_quotationNo_key" ON "customer_quotations"("tenantId", "quotationNo");
CREATE INDEX "customer_quotations_tenantId_customerCompanyId_idx" ON "customer_quotations"("tenantId", "customerCompanyId");
CREATE INDEX "customer_quotations_tenantId_customerCompanyId_status_idx" ON "customer_quotations"("tenantId", "customerCompanyId", "status");
CREATE INDEX "customer_quotations_tenantId_status_validUntil_idx" ON "customer_quotations"("tenantId", "status", "validUntil");

CREATE INDEX "customer_quotation_lines_tenantId_quotationId_idx" ON "customer_quotation_lines"("tenantId", "quotationId");
CREATE INDEX "customer_quotation_lines_tenantId_code_idx" ON "customer_quotation_lines"("tenantId", "code");

CREATE INDEX "quotation_no_counters_tenantId_idx" ON "quotation_no_counters"("tenantId");

ALTER TABLE "customer_rate_templates" ADD CONSTRAINT "customer_rate_templates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_rate_templates" ADD CONSTRAINT "customer_rate_templates_customerCompanyId_fkey" FOREIGN KEY ("customerCompanyId") REFERENCES "customer_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_rate_templates" ADD CONSTRAINT "customer_rate_templates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_rate_templates" ADD CONSTRAINT "customer_rate_templates_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_rate_template_rows" ADD CONSTRAINT "customer_rate_template_rows_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "customer_rate_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_rate_template_rows" ADD CONSTRAINT "customer_rate_template_rows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_quotations" ADD CONSTRAINT "customer_quotations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_quotations" ADD CONSTRAINT "customer_quotations_customerCompanyId_fkey" FOREIGN KEY ("customerCompanyId") REFERENCES "customer_companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_quotations" ADD CONSTRAINT "customer_quotations_sourceTemplateId_fkey" FOREIGN KEY ("sourceTemplateId") REFERENCES "customer_rate_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_quotations" ADD CONSTRAINT "customer_quotations_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_quotations" ADD CONSTRAINT "customer_quotations_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_quotations" ADD CONSTRAINT "customer_quotations_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_quotations" ADD CONSTRAINT "customer_quotations_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_quotation_lines" ADD CONSTRAINT "customer_quotation_lines_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "customer_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_quotation_lines" ADD CONSTRAINT "customer_quotation_lines_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotation_no_counters" ADD CONSTRAINT "quotation_no_counters_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
