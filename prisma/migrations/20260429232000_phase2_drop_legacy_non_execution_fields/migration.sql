-- Phase-2 cleanup: remove deprecated non-execution compatibility columns.
-- Preconditions:
-- 1) Runtime no longer reads these fields.
-- 2) External reporting/export consumers are verified.

ALTER TABLE "transport_orders"
DROP COLUMN IF EXISTS "itemsJson";

ALTER TABLE "profiles"
DROP COLUMN IF EXISTS "globalRole";

ALTER TABLE "customer_rate_master_lines"
DROP COLUMN IF EXISTS "sourceQuotationId";
