# OpsFlow backend architecture

This document describes the **current** `src/` layout after incremental domain refactors. HTTP routes and Nest module names are unchanged unless a dedicated migration says otherwise.

See also domain-specific notes:

- [`transport/README.md`](transport/README.md)
- [`warehousing/README.md`](warehousing/README.md)
- [`shared/README.md`](shared/README.md)

---

## Current domain layout

| Path | Domain | Role |
|------|--------|------|
| [`transport/`](transport/) | **Transport** | Transport execution, submodules, helpers, specs, and legacy transport-orders stack |
| [`warehousing/`](warehousing/) | **Warehousing** | Inventory and future warehouse jobs |
| [`shared/`](shared/) | **Shared / Platform** | Cross-domain infrastructure: auth, prisma, tenants, realtime, notifications, push, health, audit, places, users |
| [`finance/`](finance/) | **Finance** (transport-heavy today) | Invoicing, driver wallets, portal invoices |
| [`driver/`](driver/) | **Transport** (legacy) | Legacy transport-order mobile API (`/driver/*`) |
| [`drivers/`](drivers/) | **Transport** | Admin driver CRUD and driver self-profile |

**Other top-level folders** (not listed in the product domain map but present today): `admin/`, `dashboard/`, `common/`, `api/`, `assets/`.

---

## Transport (`src/transport/`)

Transport support modules and extracted helpers live under this folder. The **legacy transport-orders** Nest module still lives at the `transport/` root (`transport.controller`, `trip.controller`, `pod.controller`, etc.) for `/transport/orders`, `/transport/trips`, and `/transport/stops`.

| Subfolder | Purpose |
|-----------|---------|
| `customers/` | Customer companies, contacts, documents (`/customers/*`, `/customer-companies/*`, `/companies/*`) |
| `master-rates/` | Master rates, quotations, DHC, driver trip rates (`/master/*`) |
| `vehicles/` | Tenant vehicles and fleet list alias (`/vehicles/*`, `/fleet`) |
| `fleet/vehicles/` | Fleet vehicle entity (`/fleet-vehicles/*`) |
| `fleet/tracking/` | Chassis and GPS tracking (`/fleet-tracking/*`) |
| `fleet/device-gateway/` | Internal GPS ingestion (`/internal/device-gateway/*`) |
| `dispatch/` | Dispatch board, route planning, trip reorder (`/dispatch/*`) — registered via `TransportExecutionModule` |
| `jobs/` | Ops jobs controller/service, helpers, job ops DTOs, import DTOs, create-job validation |
| `trips/` | Ops trips controller, trip notes/document helpers, trip/payout DTOs |
| `driver-app/` | Driver mobile controllers, `DriverJobsService`, driver DTOs |
| `workflows/` | Job workflow kernel (`job-workflow.helpers.ts`) |
| `transport-execution.module.ts` | Nest module registering jobs, trips, driver app, and dispatch execution |

Specs are colocated under each transport subfolder (`jobs/*.spec.ts`, `trips/*.spec.ts`, `driver-app/*.spec.ts`, `documents/*.spec.ts`, `workflows/*.spec.ts`, etc.).

| `documents/` | Signature PDF layout, document uploader, DO signing, signature normalization, driver mobile document selects |
| `dto/` | Legacy transport-orders DTOs (orders, trips, stops, POD) |

### `transport/jobs/` (current)

| File / folder | Role |
|---------------|------|
| `ops-jobs.controller.ts` | `/jobs/*` HTTP routes |
| `ops-jobs.service.ts` | Main job/trip workflow monolith (~7.7k lines) |
| `job-invoice-readiness.ts` | Invoice readiness evaluation (consumed by `src/finance`) |
| `job-batch-import.helpers.ts` | Batch job import parsing helpers |
| `create-job-validation.helpers.ts` | Pure create-job validation (items parsing, location assertions, collection type resolution) |
| `dto/update-job.dto.ts` | Update job request DTO |
| `dto/assign-job.dto.ts` | Assign driver/vehicle request DTO |
| `dto/cancel-job.dto.ts` | Cancel job request DTO |
| `dto/job-list-query.dto.ts` | Job list query parameters |
| `dto/job.dto.ts` | Job response shapes (`JobDto`, `JobDocumentDto`, etc.) |
| `dto/save-job-charges.dto.ts` | Save job charges request DTO |
| `dto/create-job.dto.spec.ts` | Create job DTO validation tests |
| `dto/import-job-row.dto.ts` | Single-row import confirm DTO |
| `dto/job-batch-import.dto.ts` | Batch import confirm DTO |
| `dto/lcl-import.dto.ts` | LCL import confirm DTO |

`OpsJobsService` lives in `src/transport/jobs/` and orchestrates the create-job flow. HTTP routes remain `/jobs/*` via `TransportExecutionModule`.

### `transport/trips/` (current)

| File | Role |
|------|------|
| `ops-trips.controller.ts` | `/trips/:tripId` ops trip detail |
| `trip-notes.helpers.ts` | Trip notes field resolution for API responses |
| `trip-document-list.helpers.ts` | Trip document list shaping for ops and driver flows |

### `transport/documents/` (current)

| File | Role |
|------|------|
| `signature-pdf-layout.helpers.ts` | DO signature image placement on PDF |
| `document-uploader.utils.ts` | Document upload utilities |
| `do-signature.helpers.ts` | DO signature submission helpers |
| `signature-image-normalize.ts` | Signature image normalization for PDF |
| `driver-mobile-document.select.ts` | Prisma selects for driver mobile document views |

Transport owns customers, vehicles, fleet, master rates, dispatch, job/trip/document helpers, and transport jobs/trips execution under `transport-execution.module.ts`.

---

## Warehousing (`src/warehousing/`)

| Subfolder | Purpose |
|-----------|---------|
| `inventory/` | Stock items, batches, units (`/inventory/*`) |

**Warehouse Jobs** do not exist in the backend yet. They must be a separate warehousing concept—not transport `Job`/`Trip`.

---

## Shared (`src/shared/`)

Cross-domain infrastructure used by Transport, Warehousing, Finance, and admin/platform features.

| Subfolder | Purpose |
|-----------|---------|
| `audit/` | `AuditService` (no HTTP routes) |
| `health/` | Health probes (`/health/*`) |
| `places/` | Google Places helpers (`/places/*`) |
| `users/` | User profile and avatar (`/users/me`, `/users/me/avatar`) |

**Future candidates** to move here: truly generic parts of `common/` (transport- or warehousing-specific helpers should leave `common/` over time).

Shared must stay **infrastructure and generic utilities only**—not transport or warehousing business workflows.

---

## Finance (`src/finance/`)

Finance is **transport-heavy today** (job invoicing, driver wallets, portal invoices tied to transport jobs). `invoices.service.ts` imports `evaluateJobInvoiceReadiness` from `src/transport/jobs/job-invoice-readiness`.

**Future architecture:** split into **Transport Finance** and **Warehouse Finance** under their respective domains. Only generic billing primitives or helpers (no job-domain coupling) may eventually live in `shared/`.

**Do not move the finance module** as part of the current transport folder refactor sequence.

---

## Driver modules (legacy split)

Two modules exist for historical reasons:

### `src/driver/` — legacy transport-order mobile API

- Routes: `/driver/*` (singular prefix)
- Stack: `TransportOrder` → `Trip` where `jobId` is null; stops, POD, order inbox
- Also exports `LocationService` and DTOs used by `admin`, `transport`, and `drivers`
- **Do not add new features here**; prefer `transport/driver-app` driver execution
- **Do not move yet** — shared exports and legacy mobile clients must be audited first

### `src/drivers/` — admin CRUD and driver profile

- Routes: `/admin/drivers/*` (web Drivers page), `/drivers/me` (self-profile)
- **Does not own job execution** — that lives in `transport/driver-app` at `/drivers/jobs/*` and `/drivers/trips/*`
- Uses `UsersService` from `shared/users` for avatars
- **Do not move yet** — consolidate only after `src/driver` dependencies are untangled

---

## Platform modules (`src/shared/`)

Platform modules now live under `shared/` (see [`shared/README.md`](shared/README.md)):

| Module | Role |
|--------|------|
| `shared/auth/` | Login, token verification, guards |
| `shared/tenants/` | Tenant and membership APIs |
| `shared/prisma/` | Prisma client module |
| `shared/realtime/` | Realtime event bus |
| `shared/notifications/` | Notification fan-out |
| `shared/push/` | Expo push for drivers |

---

## Important domain rules

1. **Transport Jobs and Warehouse Jobs are separate domains.** They must not share the same Prisma models or service flows.

2. **Existing Prisma `Job` and `Trip` flows are transport-only** (LCL, IMPORT, EXPORT, COLLECTION and related execution).

3. **Future Warehouse Jobs must not reuse existing transport `Job` semantics.** Implement dedicated `WarehouseJob` (or equivalent) under `warehousing/` with new schema when ready.

4. **Do not add new warehousing logic into transport job execution.** Inventory belongs under `warehousing/inventory`.

5. **Do not add new transport-specific business logic into `shared`.** Shared is for infrastructure, platform services, and generic cross-domain helpers.

6. **Do not add warehouse job logic into `transport/`** or legacy `/driver/*` order flows.

7. **Do not rename Prisma `Job`/`Trip` models** as part of folder refactors.

---

## Do not move yet

The following are intentionally **out of scope** for the current extraction phase:

| Item | Reason |
|------|--------|
| `job-workflow.helpers.ts` | Moved to `transport/workflows/` |
| `ops-jobs.service.ts`, `driver-jobs.service.ts`, ops controllers | Moved to `src/transport/`; registered via `TransportExecutionModule` |
| Ops controllers | Route stability preserved (`/jobs`, `/drivers/jobs`, etc.) |
| `src/finance/` | Separate domain module; only imports transport job readiness today |
| `src/driver/`, `src/drivers/` | Legacy split; shared `LocationService` and DTO exports |
| PDF/signing orchestration inside `OpsJobsService` | Behavior-sensitive; helpers already extracted to `transport/documents/` |
| Prisma `Job`/`Trip` model renames | Schema change, not a folder refactor |

---

## Completed transport job extractions

The following **leaf moves are done** (import path updates only; routes and behavior unchanged):

| Extraction | Location |
|------------|----------|
| Job ops DTO cluster | `src/transport/jobs/dto/` (`create-job`, `update-job`, `assign-job`, `cancel-job`, `job-list-query`, `job`, `save-job-charges`, `create-job.dto.spec`) |
| Import DTOs | `src/transport/jobs/dto/` (`import-job-row`, `job-batch-import`, `lcl-import`) |
| Create-job validation helpers | `src/transport/jobs/create-job-validation.helpers.ts` |
| Batch import helper | `src/transport/jobs/job-batch-import.helpers.ts` |
| Invoice readiness | `src/transport/jobs/job-invoice-readiness.ts` |

---

## Next steps (not blind leaf moves)

**Do not perform additional broad safe leaf moves without an explicit audit.** The easy DTO and create-job helper extractions under `transport/jobs/` are complete.

Recommended next step:

1. **Audit and plan** `job-workflow.helpers.ts` before any move — map consumers (`ops-jobs.service.ts`, `driver-jobs.service.ts`, specs) and decide target folder (e.g. `transport/jobs/` or `transport/workflows/`).

**Delay until deliberately planned:**

| Platform module relocation | **Done** — `auth`, `prisma`, `tenants`, `realtime`, `notifications`, `push` under `src/shared/` |
| `OpsJobsService` / `DriverJobsService` splits | Behavior-sensitive; file moves only, no splits |
- Finance domain split
- `src/driver` / `src/drivers` consolidation
- Prisma `Job`/`Trip` model renames

After any future step: `npm run build` and full test suite.

---

## Future target structure

Incremental refactors should preserve routes and behavior per step.

### Transport

```
src/transport/
  customers/          (done)
  master-rates/       (done)
  vehicles/           (done)
  fleet/
    vehicles/         (done)
    tracking/         (done)
    device-gateway/   (done)
  dispatch/           (done — TransportExecutionModule)
  jobs/               (done — controller, service, helpers, DTOs)
  trips/              (done — ops trips controller, helpers, DTOs)
  documents/          (done — helpers and selects)
  driver-app/         (done — driver controllers and DriverJobsService)
  workflows/          (done — job-workflow.helpers.ts)
  orders/             ← legacy transport/orders module at transport root (future rename)
```

### Warehousing

```
src/warehousing/
  inventory/          (done)
  warehouse-jobs/     (future — new models/services, not transport Job)
  finance/            (future warehouse billing)
```

### Shared

```
src/shared/
  auth/               (done)
  tenants/            (done)
  prisma/             (done)
  realtime/           (done)
  notifications/      (done)
  push/               (done)
  audit/              (done)
  health/             (done)
  places/             (done)
  users/              (done)
```

### Finance

```
src/finance/          (current — transport-heavy)
  → eventually transport/finance and warehousing/finance
```

### Drivers

- Consolidate `src/drivers` under `src/transport/drivers` when safe.
- Split or retire `src/driver` legacy API after confirming mobile clients no longer depend on `/driver/*`.
- Merge admin driver CRUD with transport driver domain documentation—not with `ops` job execution.

---

## Refactor principles

- **Move leaf modules first** (inventory, fleet tracking, customers, master-rates, dispatch, document/trip/job helpers, job ops DTOs, create-job validation).
- **Document before moving** monoliths (`ops`, `driver`, `job-workflow.helpers.ts`).
- **Never change HTTP routes** in a folder-only move.
- **One domain per folder** over time; transport execution now lives under `src/transport`.
