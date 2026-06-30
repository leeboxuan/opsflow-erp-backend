# Ops module (Transport domain)

Despite the generic name, **`src/ops` is the current home of Transport job/trip execution** — controllers, monolith services, and driver routes. Treat everything in this folder as **Transport domain** code. **`src/ops` remains the execution home for `/jobs/*` and related routes until service extraction is explicitly planned.**

Extracted helpers and DTOs live under `src/transport/jobs`, `src/transport/trips`, `src/transport/documents`, and `src/transport/dispatch`. Ops services import and orchestrate them; routes and Nest registrations remain here.

## Routes (unchanged during refactors)

| Area | Routes | Responsibility |
|------|--------|----------------|
| Transport jobs | `/jobs` | Job CRUD, charges, documents, imports, invoicing handoff |
| Trips | `/trips`, job-scoped trip APIs | Multi-leg trip execution on transport jobs |
| Dispatch | `/dispatch` | Dispatch board, route optimisation, trip reorder — **code:** `src/transport/dispatch` (registered via `OpsModule`) |
| Driver execution | `/drivers/jobs`, `/drivers/trips`, `/drivers` | Driver mobile and ops-facing job/trip flows |

## What still lives here

### Controllers (5)

| File | Route prefix |
|------|--------------|
| `ops-jobs.controller.ts` | `/jobs` |
| `ops-trips.controller.ts` | `/trips` |
| `driver-jobs.controller.ts` | `/drivers/jobs` |
| `driver-home.controller.ts` | `/drivers` |
| `driver-trips.controller.ts` | `/drivers/trips` |

### Services (2)

| File | Role |
|------|------|
| `ops-jobs.service.ts` | Main job/trip workflow monolith (~7.7k lines): CRUD, trips, charges, documents, imports, PDF/signing orchestration, invoice readiness sync — imports create-job validators from `transport/jobs/create-job-validation.helpers.ts` and still orchestrates create-job flow |
| `driver-jobs.service.ts` | Driver mobile execution (~2.9k lines); optionally delegates DO PDF persist/refresh to `OpsJobsService` |

### Helpers (1 file + in-service exports)

| File / location | Role |
|-----------------|------|
| `job-workflow.helpers.ts` | Trip templates, completion rules, default trip seeding, route snapshots, completion document gaps — **do not move without audit** |
| `ops-jobs.service.ts` (exported) | Trip-details edit constants (`TRIP_DETAILS_*`) and `assertTripDetailsEditAllowed` — trip PATCH guards, not create-job |

### DTOs

Job ops DTOs moved to `src/transport/jobs/dto/` (imported by ops controllers and services). Remaining DTOs in `src/ops/dto/`:

| Group | Files |
|-------|-------|
| Trip / payouts | `job-trip.dto.ts` |
| Driver mobile | `driver-home-query.dto.ts`, `driver-jobs-list-query.dto.ts`, `driver-jobs-history-list-query.dto.ts`, `complete-job.dto.ts`, `driver-trip-complete.dto.ts`, `location.dto.ts`, `sign-trip-document.dto.ts`, `do-signature-submit.dto.ts` |

### Specs

Remaining `*.spec.ts` files in `src/ops/` cover job workflow, ops jobs behavior, driver mobile flows, charges, imports, and PDF signing. Specs for moved helpers live under the corresponding `src/transport/*` folders.

### Module

`ops.module.ts` registers the five ops controllers plus `DispatchController` and `DispatchService` from `../transport/dispatch/`. It imports `FinanceModule` and `AuditModule`.

## Completed extractions (consumed from `src/transport/`)

| Location | Contents | Status |
|----------|----------|--------|
| `transport/dispatch/` | Dispatch controller, service, DTO | Done |
| `transport/jobs/` | Invoice readiness, batch import helper, **create-job validation helpers**, import DTOs, **job ops DTOs** | Done |
| `transport/trips/` | Trip notes helper, trip document list helper | Done |
| `transport/documents/` | Signature PDF layout, document uploader, DO signature helpers, signature normalization, driver mobile document selects | Done |

Prisma `Job` and `Trip` (where `jobId` is set) are **transport-only**.

## Domain classification

- **Domain:** Transport (not generic “operations” spanning the whole product)
- **Not in scope:** Warehousing, warehouse jobs, or inventory business logic

Do **not** add new warehousing code, warehouse job handlers, or inventory domain logic inside `src/ops`.

Do **not** add transport-specific business logic into `src/shared`.

Future **Warehouse Jobs** must not reuse existing transport `Job` semantics.

## Relationship to `src/transport`

`src/transport` holds the legacy transport-orders stack (`/transport/orders`, `/transport/trips`, `/transport/stops`) and relocated submodules/helpers. `src/ops` holds the job-centric transport stack controllers and monolith services. Both are Transport domain; they share the `Trip` table with different lifecycles (`jobId` set vs null).

**New transport code** should eventually live under `src/transport` (and subfolders added there during refactors). `src/ops` is legacy/current placement for controllers and services, not the long-term name for this domain.

## Do not move yet

| Item | Reason |
|------|--------|
| `job-workflow.helpers.ts` | High coupling to both services and multiple specs |
| `ops-jobs.service.ts` | Orchestration monolith; all `/jobs` routes depend on it |
| `driver-jobs.service.ts` | Optional `OpsJobsService` delegation for signing/PDF |
| All ops controllers | Route stability |
| `src/finance/` | Separate domain module |
| `src/driver/`, `src/drivers/` | Legacy split; audit shared exports first |
| PDF/signing orchestration inside `OpsJobsService` | Behavior-sensitive; leaf helpers already in `transport/documents/` |
| Prisma `Job`/`Trip` model renames | Out of scope for folder refactors |

## Next steps (not blind leaf moves)

**Do not perform additional broad safe leaf moves without an explicit audit.** Job ops DTOs, import DTOs, and create-job validation helpers are complete.

Recommended next step:

1. **Audit and plan** `job-workflow.helpers.ts` — map all consumers and choose a target folder before moving.

**Delay until deliberately planned:**

- `OpsJobsService` / `DriverJobsService` splits or file moves
- Ops controller relocation
- Finance domain split
- `src/driver` / `src/drivers` consolidation
- Prisma `Job`/`Trip` model renames

After any future step: `npm run build` and full test suite.

## Completed refactor steps

1. Document domain boundaries (this file and sibling READMEs)
2. Move leaf modules with few dependencies — **done:** fleet tracking, customers, master-rates, vehicles, dispatch, job/trip/document helpers, job ops DTOs, import DTOs, create-job validation under `src/transport/*`
3. Extract helpers from `ops-jobs.service.ts` — **done for leaf helpers:** document, trip, import, and create-job validation; trip-details edit guards and orchestration remain in service
4. Relocate controllers/services under `src/transport` — **not started**; routes stay registered from `OpsModule` until explicit cutover

Routes, Prisma schema, and import paths should only change in deliberate, reviewed steps—not as part of bulk folder renames.

## Warehousing boundary

**Warehouse Jobs** are a future Warehousing concept (`src/warehousing`). They must not be implemented by extending transport `Job`, `JobType`, or ops job services. Inventory lives under `src/warehousing/inventory` (Warehousing domain).
