# PSA port-access eligibility (`hasPsaPortAccess` / `requiresPsaPortAccess`)

**Status: SOURCE ONLY — do not apply from agents.**

## Columns

| Table | Column | Default | Meaning |
|-------|--------|---------|---------|
| `drivers` | `hasPsaPortAccess` | `false` | Driver authorised to enter PSA port facilities |
| `trips` | `requiresPsaPortAccess` | `false` | Trip includes a PSA port stop; requires eligible driver |

Do **not** infer requirement from IMPORT/EXPORT alone.

## Safe apply

1. Run `preflight.sql` (read-only). Before expand, expect missing-column errors — that is OK.
2. Apply `migration.sql` during a maintenance window (additive `ADD COLUMN ... DEFAULT false`).
3. Re-run `preflight.sql` after apply to list any existing eligibility conflicts (should be empty if all defaults false and no UI writes yet).
4. Deploy API/web/mobile that enforce `DRIVER_PSA_ACCESS_REQUIRED`.

## Rollback / PITR

- **Forward-only preferred.** Dropping columns loses admin/ops toggles written after apply.
- If rollback is required before production writes: drop the two columns in a reverse migration after confirming no dependent queries.
- For production incident after writes: use PITR to a pre-apply restore point rather than silent data invention.

## Product enforcement (application)

- Assignment blocked when `requiresPsaPortAccess && !hasPsaPortAccess` → HTTP 409 `DRIVER_PSA_ACCESS_REQUIRED`
- Existing invalid assignments are **not** silently unassigned
- DRAFT publish blocked until reassigned
- PUBLISHED/ONGOING conflicts surface as urgent warnings without lifecycle mutation
- Removing driver PSA access with future active PSA trips requires confirmation (`DRIVER_PSA_ACCESS_REMOVAL_CONFLICT`)
