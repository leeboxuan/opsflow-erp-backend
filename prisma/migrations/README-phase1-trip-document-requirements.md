# Phase 1 trip document requirements — safe migration order

Migrations (apply only in this order, after a clean collision preflight):

1. `20260820170000_trip_document_requirement_stage_uploader_permit`
   Adds `PERMIT`, uploader/stage enums, and columns
   `responsibleUploader` / `requirementStage` (default `BEFORE_COMPLETE`).
2. `20260820180000_trip_document_requirement_unique_tenant_trip_type_stage`
   Adds unique index on `(tenantId, tripId, type, requirementStage)`.

`prisma migrate deploy` applies pending migrations back-to-back. Operators must
run the **pre-migration** collision preflight **before** deploy so there is no
need to inspect between the two files.

## Safe deployment checklist

1. Confirm target environment and deployed application/git revision.
2. Confirm backup / PITR coverage for the target database.
3. Run the **pre-migration collision preflight** against the untouched schema:
   - `scripts/sql/preflight-trip-document-requirement-collisions-pre-migration.sql`
   - Effective collision key before columns exist: `(tenantId, tripId, type)`
     (every existing row will receive implied stage `BEFORE_COMPLETE`).
4. **Stop** if any duplicate rows are returned.
5. Resolve duplicates only through a separately reviewed data-remediation plan.
   Do **not** use automatic duplicate-deletion or backfill SQL from this change set.
6. Run the snapshot-coverage preflight for visibility only:
   - `scripts/sql/preflight-trip-document-requirement-snapshots.sql`
   Snapshot absence does **not** authorize backfill.
7. Only after a clean collision result, apply the ordered Prisma migrations
   (e.g. `prisma migrate deploy` in the approved environment).
8. Verify columns, enums, unique index, and `_prisma_migrations` history.
9. Run focused smoke tests (requirement create conflict, publish/start/complete
   document gates, jobs-list readiness).
10. Keep rollback/recovery explicit:
    - Prefer restore from backup / PITR to the pre-migrate point if deploy must
      be undone.
    - Do not invent ad-hoc DROP COLUMN / DROP TYPE scripts without a reviewed
      rollback plan that accounts for enum value `PERMIT` and dependent data.
    - Optional post-column diagnostic (only after `20260820170000`, before or
      instead of relying solely on index creation failure):
      `prisma/migrations/20260820180000_trip_document_requirement_unique_tenant_trip_type_stage/preflight.sql`

## Preflight index

| When | File |
|------|------|
| **Required — before either Phase 1 migration** | `scripts/sql/preflight-trip-document-requirement-collisions-pre-migration.sql` |
| Optional — visibility, any time (read-only) | `scripts/sql/preflight-trip-document-requirement-snapshots.sql` |
| Optional — after columns, before unique index | `.../20260820180000_.../preflight.sql` |
