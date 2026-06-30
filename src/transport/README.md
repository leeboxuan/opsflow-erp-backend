# Transport domain

This folder is part of the **Transport** product domain. It holds transport submodules, **job/trip execution** (controllers, monolith services, and colocated specs), extracted helpers, the legacy transport-orders stack at the folder root, and **dispatch** (`/dispatch`).

## Tests

Specs live next to the code they exercise:

| Folder | Spec examples |
|--------|----------------|
| `jobs/` | `ops-jobs-create-items.spec.ts`, `lcl-import.spec.ts`, `job-charge-workflow.spec.ts` |
| `trips/` | `trip-details-edit.spec.ts`, `ops-jobs-append-trip.spec.ts`, `ops-jobs-unpublish.spec.ts`, `trip-display-ref.spec.ts`, `ops-jobs-route-plan.spec.ts` |
| `driver-app/` | `driver-jobs-home.spec.ts`, `driver-jobs-do-sign.spec.ts`, `driver-endpoint-perf.spec.ts` |
| `documents/` | `delivery-do-signed-pdf.spec.ts`, `do-signature.helpers.spec.ts`, `document-file-display.spec.ts`, `job-document-signed-url.spec.ts` |
| `workflows/` | `workflow.spec.ts` (tests `job-workflow.helpers.ts` and related trip-note helpers), `gul-circle-location.spec.ts` |
| `dispatch/` | `dispatch.service.spec.ts` |
| `finance/` | `invoice-render.spec.ts`, `invoices-wisdom-force.spec.ts` |

## Folder structure (current)

```
src/transport/
├── transport-execution.module.ts   # Nest module: jobs, trips, driver app, dispatch, finance
├── customers/                      # customer companies, contacts, documents
├── master-rates/                   # quotations, trucking rates, DHC, driver trip rates
├── vehicles/                       # tenant vehicles, /fleet alias
├── fleet/
│   ├── vehicles/                   # fleet-vehicle entity
│   ├── tracking/                   # chassis/GPS tracking
│   └── device-gateway/             # internal GPS ingestion
├── dispatch/                       # dispatch board, route planning (/dispatch)
├── finance/                        # transport finance: invoices, wallets, portal
├── jobs/                           # ops jobs controller/service, helpers, DTOs
├── trips/                          # ops trips controller, trip helpers, DTOs
├── legacy-driver/                  # legacy singular /driver/* mobile order-trip API
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
- **Drivers** — driver profiles and admin driver management (`src/transport/drivers`); legacy order mobile API in `src/transport/legacy-driver` (`/driver/*`); modern job execution under `src/transport/driver-app` (`/drivers/jobs/*`, `/drivers/trips/*`)
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
| `job-invoice-readiness.ts` | Invoice readiness evaluation (used by `finance/invoices.service.ts`) |
| `job-batch-import.helpers.ts` | Batch job import parsing |
| `create-job-validation.helpers.ts` | Pure create-job validation helpers |
| `dto/*` | Job CRUD, list, charges, import, response DTOs |
| `assets/` | Job PDF branding assets (`db-logo.png`) |

## `src/transport/drivers/` (current)

| File / folder | Role |
|---------------|------|
| `drivers.module.ts` | `DriversModule` — wired from `AppModule` |
| `drivers.controller.ts` | `/drivers/me` (driver self-profile) |
| `admin-drivers.controller.ts` | `/admin/drivers/*` (admin CRUD, suspend, wallet) |
| `admin-drivers.service.ts` | Admin driver list/create/update/suspend/wallet |
| `dto/driver-wallet.dto.ts` | `DriverWalletDto`, `DriverWalletTransactionDto` |
| `dto/*` | Admin create/update/list DTOs, `UpdateDriverDto` |
| `admin-drivers.service.spec.ts` | Admin drivers service tests |
| `location/location.service.ts` | Driver phone GPS latest position (`driverLocationLatest`); admin list + legacy mobile ingest |
| `location/dto/location.dto.ts` | `LocationDto`, `DriverLocationDto` (admin map list shape) |
| `location/dto/update-location.dto.ts` | Legacy `POST /driver/location` request body |
| `location/location.service.spec.ts` | Location service unit tests |

Legacy **`src/transport/legacy-driver/`** hosts `DriverModule` for `/driver/location`; it imports `LocationService` from `drivers/location/` until the API is retired.

## `src/transport/legacy-driver/` (current)

| File / folder | Role |
|---------------|------|
| `driver.module.ts` | `DriverModule` — wired from `AppModule` only (not `TransportExecutionModule`) |
| `driver.controller.ts` | `/driver/*` legacy mobile order-trip routes |
| `driver-mvp.service.ts` | Order-trip mobile orchestration (~1.3k lines) |
| `google-maps.service.ts` | Geocode + route optimize for legacy order-trip flows (Directions API) |
| `dto/*` | Legacy mobile trip/order DTOs |

Temporary/legacy until old clients retire. **Do not merge** with `driver-app`.

## `src/transport/trips/` (current)

| File / folder | Role |
|---------------|------|
| `ops-trips.controller.ts` | `/trips/:tripId` ops trip detail |
| `trip-notes.helpers.ts` | Trip notes field resolution |
| `trip-document-list.helpers.ts` | Trip document list shaping |
| `trip-display-ref.ts` | Human-readable trip display refs (job ref + sequence) |
| `trip-order-suggest.ts` | Nearest-neighbour trip route ordering suggestion |
| `dto/job-trip.dto.ts` | Trip append/patch/payout/reorder DTOs |
| `dto/assign-driver.dto.ts`, `dto/assign-vehicle.dto.ts` | Legacy transport-order trip assignment (`POST /transport/trips/:tripId/assign-*`) |

## `src/transport/driver-app/` (current)

| File / folder | Role |
|---------------|------|
| `driver-home.controller.ts` | `/drivers/home` |
| `driver-jobs.controller.ts` | `/drivers/jobs/*` |
| `driver-trips.controller.ts` | `/drivers/trips/*` |
| `driver-jobs.service.ts` | Driver mobile execution (~2.9k lines); optional `OpsJobsService` delegation for PDF/signing |
| `driver-endpoint-perf.ts` | Optional driver API timing logs (`DRIVER_API_PERF_LOG`); used by `DriverJobsService` and `drivers/location/LocationService` |
| `dto/*` | Driver home, jobs list/history, completion, location DTOs |

## `src/transport/workflows/` (current)

| File | Role |
|------|------|
| `job-workflow.helpers.ts` | Trip templates, completion rules, trip seeding, route snapshots |
| `gul-circle-location.ts` | Canonical 7 Gul Circle depot coords and legacy coord repair helper |

Consumed by `ops-jobs.service.ts`, `driver-jobs.service.ts`, and `workflow.spec.ts`.

## `src/transport/documents/` (current)

| File / folder | Role |
|---------------|------|
| `document-file-display.ts` | Safe client-facing filenames and display fields for stored documents |
| `job-document-signed-url.ts` | Cached Supabase signed URLs for job document storage |
| `signature-pdf-layout.helpers.ts` | DO signature image placement on PDF |
| `document-uploader.utils.ts` | Document upload utilities |
| `do-signature.helpers.ts` | DO signature submission helpers |
| `signature-image-normalize.ts` | Signature image normalization |
| `driver-mobile-document.select.ts` | Prisma selects for driver mobile documents |
| `dto/sign-trip-document.dto.ts`, `do-signature-submit.dto.ts` | Signing request DTOs |
| `delivery-do-signed-pdf.spec.ts` | DO signed PDF integration tests (via `OpsJobsService`) |

## `src/transport/finance/` (Transport Finance)

| File / folder | Role |
|---------------|------|
| `finance.module.ts` | `FinanceModule` — wired from `AppModule` and `TransportExecutionModule` |
| `finance.controller.ts` | Driver wallet routes (`/finance/wallets/*`) |
| `invoices.controller.ts` | Ops invoice CRUD and prefill (`/finance/invoices/*`) |
| `portal-invoices.controller.ts` | Customer portal invoice download (`/portal/invoices/*`) |
| `invoices.service.ts` | Invoice orchestration; imports `jobs/job-invoice-readiness` |
| `finance.service.ts` | Driver wallet summaries and transactions |
| `dto/*` | Invoice, wallet, portal DTOs |
| `assets/` | Invoice PDF template assets (WF logo, QR) |

Future **warehouse finance** belongs under `src/warehousing/finance/`, not here.

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
| `src/warehousing/` | Inventory; future warehouse finance under `warehousing/finance/` |

## Do not move yet

| Item | Reason |
|------|--------|
| `OpsJobsService` / `DriverJobsService` splits | Behavior-sensitive orchestration monoliths |
| `driver-mvp.service.ts` refactor / retirement | Legacy API still in use |
| Prisma `Job`/`Trip` renames | Schema change |

## Next steps

- Deduplicate `isContainerCargoJobType` between `create-job-validation.helpers.ts` and `job-workflow.helpers.ts`
- Retire `src/transport/legacy-driver` after client migration
- `src/warehousing/finance/` when warehouse billing is implemented

## Warehousing boundary

**Warehouse Jobs** and **Inventory** belong to `src/warehousing`. Do not add warehousing logic into transport execution or `src/shared`.
