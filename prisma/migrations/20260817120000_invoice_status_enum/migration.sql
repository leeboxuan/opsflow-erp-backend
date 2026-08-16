-- Forward-only Invoice.status conversion to enum InvoiceStatus.
-- Mapping (explicit, case-insensitive trim):
--   Draft/DRAFT → DRAFT
--   Sent/SENT → ISSUED
--   Issued/ISSUED → ISSUED
--   Paid/PAID → PAID
--   Void/VOID → VOID
-- GENERATED is not inferred from pdfGeneratedAt.
-- Unknown values fail closed (RAISE). Timestamps and invoice rows are preserved.
--
-- Rollback limitations:
--   PostgreSQL enum types are not trivially reversible. Restoring unconstrained
--   text requires ALTER COLUMN ... TYPE TEXT USING ("status"::text) and DROP TYPE
--   "InvoiceStatus" only after no columns use it. ISSUED cannot be split back
--   into Sent vs Issued. Do not apply a down migration in production.

DO $$
DECLARE
  unknown_count integer;
BEGIN
  SELECT COUNT(*) INTO unknown_count
  FROM "invoices"
  WHERE upper(btrim("status")) NOT IN ('DRAFT', 'SENT', 'ISSUED', 'PAID', 'VOID');
  IF unknown_count > 0 THEN
    RAISE EXCEPTION
      'invoice status migration refused: % unknown Invoice.status value(s). Group existing values in preflight.sql before retrying.',
      unknown_count;
  END IF;
END $$;

CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'GENERATED', 'ISSUED', 'PAID', 'VOID');

ALTER TABLE "invoices" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "invoices"
  ALTER COLUMN "status" TYPE "InvoiceStatus"
  USING (
    CASE upper(btrim("status"))
      WHEN 'DRAFT' THEN 'DRAFT'::"InvoiceStatus"
      WHEN 'SENT' THEN 'ISSUED'::"InvoiceStatus"
      WHEN 'ISSUED' THEN 'ISSUED'::"InvoiceStatus"
      WHEN 'PAID' THEN 'PAID'::"InvoiceStatus"
      WHEN 'VOID' THEN 'VOID'::"InvoiceStatus"
    END
  );

ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'DRAFT'::"InvoiceStatus";
ALTER TABLE "invoices" ALTER COLUMN "status" SET NOT NULL;
