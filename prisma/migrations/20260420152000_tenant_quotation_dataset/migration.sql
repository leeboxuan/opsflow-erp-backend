-- Tenant-level quotation dataset rows (import/edit source for pricing)
CREATE TABLE "tenant_quotation_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "section" TEXT,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "containerSize" TEXT,
    "tripMode" TEXT,
    "areaScope" TEXT,
    "unit" TEXT,
    "rateCents" INTEGER,
    "requiresManualAmount" BOOLEAN NOT NULL DEFAULT false,
    "rawRateText" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sourceType" TEXT NOT NULL DEFAULT 'EXCEL_IMPORT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_quotation_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_quotation_items_tenantId_active_sortOrder_idx"
ON "tenant_quotation_items"("tenantId", "active", "sortOrder");

CREATE INDEX "tenant_quotation_items_tenantId_code_idx"
ON "tenant_quotation_items"("tenantId", "code");

ALTER TABLE "tenant_quotation_items"
ADD CONSTRAINT "tenant_quotation_items_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
