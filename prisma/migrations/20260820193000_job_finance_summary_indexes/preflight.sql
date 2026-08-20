-- Read-only preflight for Phase 3 job-finance indexes.
-- Does not mutate data. Run before applying migration 20260820193000.

SELECT 1 AS preflight_ok;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('trip_expenses', 'invoices')
  AND (
    indexname LIKE '%jobId%'
    OR indexname LIKE '%sourceJobId%'
    OR indexname LIKE '%reviewStatus%'
  )
ORDER BY tablename, indexname;
