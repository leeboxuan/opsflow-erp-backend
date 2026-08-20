# Phase 4 — Job types + trip type (UNAPPLIED)

Additive expand/backfill/contract. Does **not** alter Phase 1–3 migrations.

## Contents

- `migration.sql` — `job_type_assignments` table; nullable `trips.tripType`; backfill from legacy `jobs.jobType`
- `preflight.sql` — read-only inventory of unsafe / unbackfillable rows

## Compatibility

- `jobs.jobType` remains required for legacy readers.
- Canonical multi-value field is `job_type_assignments`.
- `trips.tripType` stays nullable until contract step after verified backfill.
- Do **not** default null trip types to `COLLECTION`.

## Status

**Not applied.** Do not run `prisma migrate deploy` / `migrate dev` as part of Phase 4 implementation.

## Retirement path

1. Clients consume `jobTypes` / `tripType` + `*Source` fields.
2. Stop writing business logic against singular `Job.jobType` alone.
3. Later contract migration: enforce `trips.tripType NOT NULL` for job-bound trips, then eventually drop `jobs.jobType`.
