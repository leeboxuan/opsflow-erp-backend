# Phase 3 — Job finance summary indexes (UNAPPLIED)

Additive only. Does **not** alter Phase 1 or Phase 2 migrations.

## Contents

- `migration.sql` — indexes:
  - `trip_expenses (tenantId, jobId, reviewStatus)` for approved-expense aggregation
  - `invoices (tenantId, sourceJobId, status)` for recognized invoice revenue by job
- `preflight.sql` — read-only index inventory

## Status

**Not applied.** Do not run `prisma migrate deploy` / `migrate dev` as part of Phase 3 implementation.

## Rollback

```sql
DROP INDEX IF EXISTS "trip_expenses_tenantId_jobId_reviewStatus_idx";
DROP INDEX IF EXISTS "invoices_tenantId_sourceJobId_status_idx";
```
