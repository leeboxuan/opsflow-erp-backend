# Transport domain

This folder is part of the **Transport** product domain. It holds relocated transport submodules, extracted job/trip/document helpers, the legacy transport-orders stack at the folder root, and **dispatch** (`/dispatch`).

## Folder structure (current)

```
src/transport/
├── customers/              # customer companies, contacts, documents
├── master-rates/           # quotations, trucking rates, DHC, driver trip rates
├── vehicles/               # tenant vehicles, /fleet alias
├── fleet/
│   ├── vehicles/           # fleet-vehicle entity
│   ├── tracking/           # chassis/GPS tracking
│   └── device-gateway/     # internal GPS ingestion
├── dispatch/               # dispatch board, route planning (/dispatch)
├── jobs/                   # job helpers, job ops DTOs, create-job validation (see below)
├── trips/                  # trip-level helpers (see below)
├── documents/              # document/signature helpers (see below)
├── dto/                    # legacy transport-orders DTOs
├── transport.module.ts     # legacy /transport/orders, /transport/trips, /transport/stops
└── *.controller.ts, *.service.ts at root  # legacy order-centric stack
```

## What Transport owns

Transport is responsible for:

- **Customers** — customer companies, contacts, and company documents (`src/transport/customers`)
- **Drivers** — driver profiles and admin driver management (`src/drivers`, `src/driver`); driver mobile **job execution** routes still registered from `src/ops`
- **Vehicles** — tenant vehicle records (`src/transport/vehicles`)
- **Fleet** — fleet vehicles, fleet list aliases, and fleet operations (`src/transport/fleet/vehicles`)
- **Fleet Tracking** — chassis/GPS devices, live positions, and device-gateway ingestion (`src/transport/fleet/tracking`, `src/transport/fleet/device-gateway`)
- **Master Rates** — quotations, trucking rates, DHC references, and driver trip rate masters (`src/transport/master-rates`)
- **Dispatch** — dispatch board, route planning, and trip reordering (`src/transport/dispatch`)
- **Transport Jobs** — job-centric workflows (LCL, IMPORT, EXPORT, COLLECTION); helpers, job ops DTOs, and create-job validation in `src/transport/jobs`; `OpsJobsService` still orchestrates create-job flow; controllers and routes still in `src/ops` (`/jobs/*`)
- **Trips** — trip execution, routing, documents, and payouts; trip helpers in `src/transport/trips`; ops/driver controllers still in `src/ops`
- **Documents** — job/trip document and signature helpers in `src/transport/documents`; PDF/signing orchestration still in `ops-jobs.service.ts`

## `src/transport/jobs/` (current)

| File / folder | Role |
|---------------|------|
| `job-invoice-readiness.ts` | Evaluates whether a transport job is ready for invoicing (used by `src/ops` and `src/finance/invoices.service.ts`) |
| `job-batch-import.helpers.ts` | Parsing and validation for batch job imports |
| `create-job-validation.helpers.ts` | Pure create-job validation helpers (items parsing, location assertions, collection type resolution) |
| `dto/import-job-row.dto.ts` | Single-row import confirm request DTO |
| `dto/job-batch-import.dto.ts` | Batch import confirm request DTO |
| `dto/lcl-import.dto.ts` | LCL import confirm request DTO |
| `dto/create-job.dto.ts` | Create job request DTO |
| `dto/update-job.dto.ts` | Update job request DTO |
| `dto/assign-job.dto.ts` | Assign driver/vehicle request DTO |
| `dto/cancel-job.dto.ts` | Cancel job request DTO |
| `dto/job-list-query.dto.ts` | Job list query parameters |
| `dto/job.dto.ts` | Job response shapes (`JobDto`, `JobDocumentDto`, etc.) |
| `dto/save-job-charges.dto.ts` | Save job charges request DTO |
| `dto/create-job.dto.spec.ts` | Create job DTO validation tests |

Ops controllers and services in `src/ops` import these DTOs and validation helpers; routes remain unchanged.

## Completed under `transport/jobs/`

| Extraction | Status |
|------------|--------|
| Job ops DTO cluster | **Done** — `dto/create-job`, `update-job`, `assign-job`, `cancel-job`, `job-list-query`, `job`, `save-job-charges`, `create-job.dto.spec` |
| Import DTOs | **Done** — `dto/import-job-row`, `job-batch-import`, `lcl-import` |
| Create-job validation helpers | **Done** — `create-job-validation.helpers.ts` |
| Batch import helper | **Done** — `job-batch-import.helpers.ts` |
| Invoice readiness | **Done** — `job-invoice-readiness.ts` |

## `src/transport/trips/` (current)

| File | Role |
|------|------|
| `trip-notes.helpers.ts` | Resolves trip notes fields for API responses |
| `trip-document-list.helpers.ts` | Shapes trip document lists for ops and driver mobile flows |

## `src/transport/documents/` (current)

| File | Role |
|------|------|
| `signature-pdf-layout.helpers.ts` | Computes DO signature image placement on PDF pages |
| `document-uploader.utils.ts` | Shared document upload utilities |
| `do-signature.helpers.ts` | DO signature submission and debug helpers |
| `signature-image-normalize.ts` | Normalizes signature images before PDF embedding |
| `driver-mobile-document.select.ts` | Prisma `select`/`include` shapes for driver mobile document views |

Ops services (`ops-jobs.service.ts`, `driver-jobs.service.ts`) import these helpers and still own signing/PDF refresh orchestration.

## `src/transport/dispatch/` (current)

- **Code location:** `src/transport/dispatch/` (`dispatch.controller.ts`, `dispatch.service.ts`, `dto/dispatch.dto.ts`)
- **Routes:** `/dispatch/*` (unchanged)
- **Nest wiring:** `DispatchController` and `DispatchService` are registered through `OpsModule` in `src/ops/ops.module.ts` — not a separate top-level `AppModule` import

## Legacy order-centric stack (transport root)

The original transport-orders Nest module remains at the `transport/` root:

- Routes: `/transport/orders`, `/transport/trips`, `/transport/stops`
- Files: `transport.module.ts`, `transport.controller.ts`, `transport.service.ts`, `trip.controller.ts`, `trip.service.ts`, `stop.service.ts`, `pod.controller.ts`, `pod.service.ts`, `event-log.service.ts`
- DTOs: `src/transport/dto/`

This stack uses `Trip` rows where `jobId` is null (order-linked trips). The job-centric stack in `src/ops` uses `Trip` rows where `jobId` is set.

## Transport jobs and trips

Existing Prisma `Job` and `Trip` models and their API flows are **transport-only**. They represent trucking/logistics execution (pickup, delivery, multi-leg trips, driver assignment, POD, invoicing handoff).

Do **not** add warehouse job logic, warehouse workflows, or inventory-fulfillment job flows into this domain or into transport `Job`/`Trip` code paths.

Future **Warehouse Jobs** must not reuse existing transport `Job` semantics.

## Related code outside this folder

| Current location | Role |
|------------------|------|
| `src/ops` | Job/trip controllers, `ops-jobs.service.ts`, `driver-jobs.service.ts`, `job-workflow.helpers.ts`, trip-details edit guards in `ops-jobs.service.ts`, remaining DTOs and specs (see `src/ops/README.md`) |
| `src/drivers`, `src/driver` | Admin driver CRUD and legacy order-trip mobile API |
| `src/finance` | Invoicing and wallets; imports `transport/jobs/job-invoice-readiness` |

New transport features should prefer `src/transport` (or subfolders added under it during refactors). Legacy modules will be moved here incrementally without changing routes or behavior in a single step.

## Do not move yet

| Item | Reason |
|------|--------|
| `src/ops/job-workflow.helpers.ts` | Trip template and completion kernel; coupled to both monolith services |
| `src/ops/ops-jobs.service.ts`, `driver-jobs.service.ts` | Orchestration monoliths |
| Ops controllers | Route stability |
| `src/finance/` | Separate domain; do not fold into transport during this phase |
| `src/driver/`, `src/drivers/` | Legacy split with shared exports |
| PDF/signing orchestration in `OpsJobsService` | Behavior-sensitive; leaf helpers already here in `documents/` |
| Prisma `Job`/`Trip` renames | Schema change |

## Next steps (not blind leaf moves)

**Do not perform additional broad safe leaf moves without an explicit audit.** Job ops DTOs, import DTOs, and create-job validation helpers under `transport/jobs/` are complete.

Recommended next step:

1. **Audit and plan** `src/ops/job-workflow.helpers.ts` before any move.

**Delay until deliberately planned:**

- `OpsJobsService` / `DriverJobsService` splits or file moves
- Ops controller relocation
- Finance domain split
- `src/driver` / `src/drivers` consolidation
- Prisma `Job`/`Trip` renames

`src/ops` remains the current transport job/trip execution home until service extraction is explicitly planned.

## Warehousing boundary

**Warehouse Jobs** and **Inventory** belong to the Warehousing domain (`src/warehousing`). They are separate product concepts. Inventory may link units to transport orders for outbound delivery, but that is an integration boundary—not a reason to model warehouse work as transport jobs.

Do not add warehousing logic into `src/ops` or transport-specific business logic into `src/shared`.
