# Phase 2 trip expenses — safe migration order

Migration:

1. `20260820190000_trip_expenses` — additive enums + tables
   `trip_expenses`, `trip_expense_attachments`, `trip_expense_events`.

## Checklist

1. Confirm target environment and deployed revision.
2. Confirm backup / PITR.
3. Run `preflight.sql` (returns `SELECT 1`; no existing collision surface).
4. Apply `prisma migrate deploy` only after Phase 1 migrations are applied if both are pending.
5. Verify tables, enums, FKs, and `_prisma_migrations`.
6. Run focused expense smoke tests.
7. Rollback via backup/PITR if needed. Do not invent DROP TABLE scripts without review.

## Rules

- Do not backfill expense amounts from legacy receipt / `TripDocument` files.
- Do not auto-delete data.
- Unique `(tenantId, storageKey)` is safe on empty attachment table.
