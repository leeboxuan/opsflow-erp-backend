# Phase 4 — Job / trip types

## Safe order (do not skip)

1. **Required:** run `preflight-pre-migration.sql` against the untouched pre-Phase-4 schema
   (references only existing tables/columns — never `job_type_assignments` or `trips.tripType`).
2. Apply `migration.sql` (expand + backfill only; `Trip.tripType` stays **nullable**).
3. **Optional:** run `preflight-post-expand.sql` to verify backfill / integrity before any later contract.
4. Later contract migration (separate): `ALTER TABLE trips ALTER COLUMN "tripType" SET NOT NULL` — only after verified backfill and clients always write `tripType`.

**Do not apply these migrations from agent sessions unless explicitly requested.**

## Nullability vs application requirements

| Layer | Job.jobType | Trip.tripType |
|-------|-------------|---------------|
| New API writes | Null for multi-type; set for single-type | Required on create/append/edit when editable |
| DB after this expand | Nullable | Nullable |
| Legacy read fallback | Explicit `LEGACY_FALLBACK` when no assignments | Explicit `LEGACY_FALLBACK` when null |
| Later contract | Keep nullable (compat) or drop column | Optional SET NOT NULL |

## Compatibility field

- Canonical: `job_type_assignments` / `jobTypes[]`.
- `Job.jobType` is **compatibility-only**. Multi-type jobs store **null** — never the first sorted type.
- Readers must prefer `jobTypes`; treat null singular as “no singular classification”.

## Supported multi-type combinations

- `IMPORT` + `COLLECTION`
- `EXPORT` + `COLLECTION`
- All single types

Unsupported mixes (409 `JOB_TYPE_COMBINATION_UNSUPPORTED`): e.g. `LCL`+anything, `IMPORT`+`EXPORT`, three-type sets.

## Internal ref

Multi-type jobs use neutral suffix `MULTI` (not IMP/EXP/LCL/COL chosen by array order).

## Hidden dependencies (Phase 0) and handling

| Dependency | Handling |
|------------|----------|
| Auto-trips | Only when exactly one job type |
| Cargo / route | Membership checks; multi-type uses shared container/LCL mode without inventing mixed topology |
| Pricing / payout | Trip uses `Trip.tripType`; no charge multiplication by type count |
| Filters / stats | Contains membership; distinct-job totals once; trip movements prefer `tripType` |
| Mobile | Display `tripType`; driver read-only |

## Unresolved product rules

- Broader multi-type cargo/route topologies beyond IMPORT/EXPORT+COLLECTION.
- Multi-type job-level rate/`tripMode` precedence.
