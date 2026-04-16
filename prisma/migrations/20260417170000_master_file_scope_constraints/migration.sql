-- Scope integrity by type:
-- - CUSTOMER_QUOTATION requires customerCompanyId
-- - DRIVER_PAYOUT and DHC_REFERENCE require customerCompanyId IS NULL
ALTER TABLE "master_files"
ADD CONSTRAINT "master_files_scope_by_type_chk"
CHECK (
  ("type" = 'CUSTOMER_QUOTATION' AND "customerCompanyId" IS NOT NULL)
  OR
  ("type" IN ('DRIVER_PAYOUT', 'DHC_REFERENCE') AND "customerCompanyId" IS NULL)
);

-- Active version uniqueness:
-- 1) One active quotation per tenant + customer + type.
CREATE UNIQUE INDEX "master_files_active_customer_quote_uniq"
ON "master_files"("tenantId", "customerCompanyId", "type")
WHERE "isActive" = true AND "type" = 'CUSTOMER_QUOTATION';

-- 2) One active tenant-wide file per tenant + type for payout/DHC.
CREATE UNIQUE INDEX "master_files_active_tenant_wide_uniq"
ON "master_files"("tenantId", "type")
WHERE "isActive" = true AND "type" IN ('DRIVER_PAYOUT', 'DHC_REFERENCE');
