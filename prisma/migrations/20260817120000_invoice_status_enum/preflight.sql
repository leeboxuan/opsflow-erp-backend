-- READ-ONLY preflight for 20260817120000_invoice_status_enum.
-- Do not run as a Prisma migrate deploy against UAT/production until authorized.
-- This file must not mutate rows. Unknown values are refused by migration.sql.

-- 1) Grouped existing Invoice.status values (string column before conversion)
SELECT
  "status" AS stored_status,
  upper(btrim("status")) AS normalized,
  COUNT(*) AS n
FROM "invoices"
GROUP BY 1, 2
ORDER BY n DESC, stored_status;

-- 2) Unknown values that will fail the forward migration (must be empty)
SELECT
  "status" AS stored_status,
  upper(btrim("status")) AS normalized,
  COUNT(*) AS n
FROM "invoices"
WHERE upper(btrim("status")) NOT IN ('DRAFT', 'SENT', 'ISSUED', 'PAID', 'VOID')
GROUP BY 1, 2
ORDER BY n DESC, stored_status;

-- 3) Mapping preview (read-only). pdfGeneratedAt is NOT used to infer GENERATED.
SELECT
  CASE upper(btrim("status"))
    WHEN 'DRAFT' THEN 'DRAFT'
    WHEN 'SENT' THEN 'ISSUED'
    WHEN 'ISSUED' THEN 'ISSUED'
    WHEN 'PAID' THEN 'PAID'
    WHEN 'VOID' THEN 'VOID'
    ELSE 'UNKNOWN'
  END AS mapped_status,
  COUNT(*) AS n,
  COUNT(*) FILTER (WHERE "pdfGeneratedAt" IS NOT NULL) AS with_pdf_generated_at
FROM "invoices"
GROUP BY 1
ORDER BY n DESC;
