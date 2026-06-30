# Transport domain

This folder is part of the **Transport** product domain. It holds transport submodules, **job/trip execution** (controllers, monolith services, and colocated specs), extracted helpers, the legacy transport-orders stack at the folder root, and **dispatch** (`/dispatch`).

## Tests

Specs live next to the code they exercise:

| Folder | Spec examples |
|--------|----------------|
| `jobs/` | `ops-jobs-create-items.spec.ts`, `lcl-import.spec.ts`, `job-charge-workflow.spec.ts` |
| `trips/` | `trip-details-edit.spec.ts`, `ops-jobs-append-trip.spec.ts`, `ops-jobs-unpublish.spec.ts` |
| `driver-app/` | `driver-jobs-home.spec.ts`, `driver-jobs-do-sign.spec.ts` |
| `documents/` | `delivery-do-signed-pdf.spec.ts`, `do-signature.helpers.spec.ts` |
| `workflows/` | `workflow.spec.ts` (tests `job-workflow.helpers.ts` and related trip-note helpers) |
| `dispatch/` | `dispatch.service.spec.ts` |

## Folder structure (current)

```
src/transport/
├── transport-execution.module.ts   # Nest module: jobs, trips, driver app, dispatch
├── customers/                      # customer companies, contacts, documents
├── master-rates/                   # quotations, trucking rates, DHC, driver trip rates
├── vehicles/                       # tenant vehicles, /fleet alias
├── fleet/
│   ├── vehicles/                   # fleet-vehicle entity
│   ├── tracking/                   # chassis/GPS tracking
│   └── device-gateway/             # internal GPS ingestion
├── dispatch/                       # dispatch board, route planning (/dispatch)
├── jobs/                           # ops jobs controller/service, helpers, DTOs
├── trips/                          # ops trips controller, trip helpers, DTOs
├── driver-app/                     # driver mobile controllers, service, DTOs
├── documents/                      # document/signature helpers and DTOs
├── workflows/                      # trip template and completion workflow kernel
├── dto/                            # legacy transport-orders DTOs
├── transport.module.ts             # legacy /transport/orders, /transport/trips, /transport/stops
└── *.controller.ts, *.service.ts at root  # legacy order-centric stack
```

## Transport execution module

`transport-execution.module.ts` is imported by `AppModule` and registers:

| Controller | Route prefix | Service dependencies |
|------------|--------------|----------------------|
| `jobs/ops-jobs.controller.ts` | `/jobs` | `OpsJobsService` |
| `trips/ops-trips.controller.ts` | `/trips` | `OpsJobsService` |
| `driver-app/driver-home.controller.ts` | `/drivers` | `DriverJobsService` |
| `driver-app/driver-jobs.controller.ts` | `/drivers/jobs` | `DriverJobsService` |
| `driver-app/driver-trips.controller.ts` | `/drivers/trips` | `DriverJobsService` |
| `dispatch/dispatch.controller.ts` | `/dispatch` | `DispatchService` |

Providers: `OpsJobsService`, `DriverJobsService`, `DispatchService`. Imports: `PrismaModule`, `AuthModule`, `AuditModule`, `FinanceModule`.

## What Transport owns

Transport is responsible for:

- **Customers** — customer companies, contacts, and company documents (`src/transport/customers`)
- **Drivers** — driver profiles and admin driver management (`src/drivers`, `src/driver`); driver mobile **job execution** under `src/transport/driver-app`
- **Vehicles** — tenant vehicle records (`src/transport/vehicles`)
- **Fleet** — fleet vehicles, fleet list aliases, and fleet operations (`src/transport/fleet/vehicles`)
- **Fleet Tracking** — chassis/GPS devices, live positions, and device-gateway ingestion (`src/transport/fleet/tracking`, `src/transport/fleet/device-gateway`)
- **Master Rates** — quotations, trucking rates, DHC references, and driver trip rate masters (`src/transport/master-rates`)
- **Dispatch** — dispatch board, route planning, and trip reordering (`src/transport/dispatch`)
- **Transport Jobs** — job-centric workflows (LCL, IMPORT, EXPORT, COLLECTION); `OpsJobsService` orchestrates create-job, trips, documents, imports (`src/transport/jobs`)
- **Trips** — trip execution, routing, documents, and payouts (`src/transport/trips`)
- **Documents** — job/trip document and signature helpers (`src/transport/documents`); PDF/signing orchestration in `OpsJobsService`

## `src/transport/jobs/` (current)

| File / folder | Role |
|---------------|------|
| `ops-jobs.controller.ts` | `/jobs/*` HTTP routes |
| `ops-jobs.service.ts` | Main job/trip workflow monolith (~7.7k lines); trip-details edit guards exported from here |
| `job-invoice-readiness.ts` | Invoice readiness evaluation (used by `src/finance/invoices.service.ts`) |
| `job-batch-import.helpers.ts` | Batch job import parsing |
| `create-job-validation.helpers.ts` | Pure create-job validation helpers |
| `dto/*` | Job CRUD, list, charges, import, response DTOs |

## `src/transport/trips/` (current)

| File / folder | Role |
|---------------|------|
| `ops-trips.controller.ts` | `/trips/:tripId` ops trip detail |
| `trip-notes.helpers.ts` | Trip notes field resolution |
| `trip-document-list.helpers.ts` | Trip document list shaping |
| `dto/job-trip.dto.ts` | Trip append/patch/payout/reorder DTOs |

## `src/transport/driver-app/` (current)

| File / folder | Role |
|---------------|------|
| `driver-home.controller.ts` | `/drivers/home` |
| `driver-jobs.controller.ts` | `/drivers/jobs/*` |
| `driver-trips.controller.ts` | `/drivers/trips/*` |
| `driver-jobs.service.ts` | Driver mobile execution (~2.9k lines); optional `OpsJobsService` delegation for PDF/signing |
| `dto/*` | Driver home, jobs list/history, completion, location DTOs |

## `src/transport/workflows/` (current)

| File | Role |
|------|------|
| `job-workflow.helpers.ts` | Trip templates, completion rules, trip seeding, route snapshots |

Consumed by `ops-jobs.service.ts`, `driver-jobs.service.ts`, and `workflow.spec.ts`.

## `src/transport/documents/` (current)

| File / folder | Role |
|---------------|------|
| `signature-pdf-layout.helpers.ts` | DO signature image placement on PDF |
| `document-uploader.utils.ts` | Document upload utilities |
| `do-signature.helpers.ts` | DO signature submission helpers |
| `signature-image-normalize.ts` | Signature image normalization |
| `driver-mobile-document.select.ts` | Prisma selects for driver mobile documents |
| `dto/sign-trip-document.dto.ts`, `do-signature-submit.dto.ts` | Signing request DTOs |
| `delivery-do-signed-pdf.spec.ts` | DO signed PDF integration tests (via `OpsJobsService`) |

## `src/transport/dispatch/` (current)

- **Routes:** `/dispatch/*` (unchanged)
- **Wiring:** registered in `TransportExecutionModule`

## Legacy order-centric stack (transport root)

The original transport-orders Nest module remains at the `transport/` root:

- Routes: `/transport/orders`, `/transport/trips`, `/transport/stops`
- Uses `Trip` rows where `jobId` is null. The job-centric stack uses `Trip` rows where `jobId` is set.

## Related code outside this folder

| Location | Role |
|----------|------|
| `src/drivers`, `src/driver` | Admin driver CRUD and legacy order-trip mobile API |
| `src/finance` | Invoicing and wallets; imports `transport/jobs/job-invoice-readiness` |

## Do not move yet

| Item | Reason |
|------|--------|
| `OpsJobsService` / `DriverJobsService` splits | Behavior-sensitive orchestration monoliths |
| `src/finance/` | Separate domain |
| `src/driver/`, `src/drivers/` | Legacy split with shared exports |
| Prisma `Job`/`Trip` renames | Schema change |

## Next steps

- Deduplicate `isContainerCargoJobType` between `create-job-validation.helpers.ts` and `job-workflow.helpers.ts`
- Finance domain split, `src/driver` / `src/drivers` consolidation (separate efforts)

## Warehousing boundary

**Warehouse Jobs** and **Inventory** belong to `src/warehousing`. Do not add warehousing logic into transport execution or `src/shared`.
