# OpsFlow backend architecture

This document describes the **current** `src/` layout after incremental domain refactors. HTTP routes and Nest module names are unchanged unless a dedicated migration says otherwise.

See also domain-specific notes:

- [`transport/README.md`](transport/README.md)
- [`warehousing/README.md`](warehousing/README.md)
- [`shared/README.md`](shared/README.md)
- [`ops/README.md`](ops/README.md)

---

## Current domain layout

| Path | Domain | Role |
|------|--------|------|
| [`transport/`](transport/) | **Transport** | Relocated transport support modules, extracted job/trip/document helpers, and legacy transport-orders stack |
| [`warehousing/`](warehousing/) | **Warehousing** | Inventory and future warehouse jobs |
| [`shared/`](shared/) | **Shared** | Cross-domain infrastructure and generic utilities |
| [`ops/`](ops/) | **Transport** (legacy placement) | Transport job/trip execution: controllers, monolith services, workflow helper, trip-detail edit guards, remaining DTOs and specs |
| [`finance/`](finance/) | **Finance** (transport-heavy today) | Invoicing, driver wallets, portal invoices |
| [`auth/`](auth/) | **Platform** | Authentication, JWT, Supabase, guards |
| [`tenants/`](tenants/) | **Platform** | Multi-tenancy and membership |
| [`prisma/`](prisma/) | **Platform** | Database client |
| [`realtime/`](realtime/) | **Platform** | SSE / realtime events |
| [`notifications/`](notifications/) | **Platform** | In-app notifications |
| [`push/`](push/) | **Platform** | Driver push devices and delivery |
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
| `dispatch/` | Dispatch board, route planning, trip reorder (`/dispatch/*`) — registered via `OpsModule` |
| `jobs/` | Job helpers, job ops DTOs, import DTOs, create-job validation (see below) |
| `trips/` | Trip notes and trip document list helpers |
| `documents/` | Signature PDF layout, document uploader, DO signing, signature normalization, driver mobile document selects |
| `dto/` | Legacy transport-orders DTOs (orders, trips, stops, POD) |

### `transport/jobs/` (current)

| File / folder | Role |
|---------------|------|
| `job-invoice-readiness.ts` | Invoice readiness evaluation (consumed by `src/ops` and `src/finance`) |
| `job-batch-import.helpers.ts` | Batch job import parsing helpers |
| `create-job-validation.helpers.ts` | Pure create-job validation (items parsing, location assertions, collection type resolution) |
| `dto/create-job.dto.ts` | Create job request DTO |
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

`OpsJobsService` in `src/ops` imports these helpers and DTOs and still orchestrates the create-job flow. HTTP routes remain `/jobs/*` via ops controllers.

### `transport/trips/` (current)

| File | Role |
|------|------|
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

Transport owns customers, vehicles, fleet, master rates, dispatch, job/trip/document helpers, and transport jobs/trips execution (controllers and monolith services still in `ops`).

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

**Future candidates** to move here (still at `src/` root today): `auth`, `tenants`, `prisma`, `realtime`, `notifications`, `push`, and truly generic parts of `common/`.

Shared must stay **infrastructure and generic utilities only**—not transport or warehousing business workflows.

---

## Ops (`src/ops/`)

Despite the generic name, **`ops/` is the current home of transport job/trip execution** — controllers, monolith services, and driver routes. Treat it as **Transport domain** code in its current location until service extraction is explicitly planned. Extracted helpers and DTOs live under `src/transport/*`; ops services import and orchestrate them.

| Area | Routes (examples) |
|------|-------------------|
| Transport jobs | `/jobs/*` |
| Trips (ops detail) | `/trips/:tripId` |
| Dispatch | `/dispatch/*` (code in `src/transport/dispatch`, registered via `OpsModule`) |
| Driver home | `/drivers/home` |
| Driver job execution | `/drivers/jobs/*` |
| Driver trip detail | `/drivers/trips/*` |

### Still owned by `src/ops`

| Category | Files |
|----------|-------|
| **Controllers** | `ops-jobs.controller.ts`, `ops-trips.controller.ts`, `driver-jobs.controller.ts`, `driver-home.controller.ts`, `driver-trips.controller.ts` |
| **Services** | `ops-jobs.service.ts` (~7.7k lines), `driver-jobs.service.ts` (~2.9k lines) — still orchestrate create-job, trip, document, and import flows |
| **Helpers** | `job-workflow.helpers.ts` (trip templates, completion rules, trip seeding) |
| **In-service exports** | Trip-details edit constants and `assertTripDetailsEditAllowed` remain in `ops-jobs.service.ts` |
| **DTOs** | Remaining files in `src/ops/dto/` (trip/payout, driver mobile, signing — job ops and import DTOs are in `transport/jobs/dto/`) |
| **Specs** | Remaining `*.spec.ts` files in `src/ops/` |
| **Module** | `ops.module.ts` — registers ops controllers plus `DispatchController`/`DispatchService` from `transport/dispatch/` |

`ops-jobs.service.ts` is the main job/trip workflow monolith. New **warehousing** logic must not be added here.

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
- **Do not add new features here**; prefer `ops` driver execution or future `transport/driver-app`
- **Do not move yet** — shared exports and legacy mobile clients must be audited first

### `src/drivers/` — admin CRUD and driver profile

- Routes: `/admin/drivers/*` (web Drivers page), `/drivers/me` (self-profile)
- **Does not own job execution** — that lives in `ops` at `/drivers/jobs/*` and `/drivers/trips/*`
- Uses `UsersService` from `shared/users` for avatars
- **Do not move yet** — consolidate only after `src/driver` dependencies are untangled

---

## Platform modules (root level, not yet under `shared/`)

| Module | Role |
|--------|------|
| `auth/` | Login, token verification, guards |
| `tenants/` | Tenant and membership APIs |
| `prisma/` | Prisma client module |
| `realtime/` | Realtime event bus |
| `notifications/` | Notification fan-out |
| `push/` | Expo push for drivers |

---

## Important domain rules

1. **Transport Jobs and Warehouse Jobs are separate domains.** They must not share the same Prisma models or service flows.

2. **Existing Prisma `Job` and `Trip` flows are transport-only** (LCL, IMPORT, EXPORT, COLLECTION and related execution).

3. **Future Warehouse Jobs must not reuse existing transport `Job` semantics.** Implement dedicated `WarehouseJob` (or equivalent) under `warehousing/` with new schema when ready.

4. **Do not add new warehousing logic into `ops`.** Inventory belongs under `warehousing/inventory`.

5. **Do not add new transport-specific business logic into `shared`.** Shared is for infrastructure, platform services, and generic cross-domain helpers.

6. **Do not add warehouse job logic into `transport/`** or legacy `/driver/*` order flows.

7. **Do not rename Prisma `Job`/`Trip` models** as part of folder refactors.

---

## Do not move yet

The following are intentionally **out of scope** for the current extraction phase:

| Item | Reason |
|------|--------|
| `job-workflow.helpers.ts` | High coupling to both monolith services and multiple specs |
| `ops-jobs.service.ts` | Main orchestration monolith; Nest wiring and all job routes depend on it |
| `driver-jobs.service.ts` | Optional delegation to `OpsJobsService` for PDF/signing |
| Ops controllers | Route stability (`/jobs`, `/drivers/jobs`, etc.) |
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

- `OpsJobsService` / `DriverJobsService` splits or file moves
- Ops controller relocation
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
  dispatch/           (done — registered via OpsModule)
  jobs/               (done — helpers, job ops DTOs, import DTOs, create-job validation)
  trips/              (partial — trip helpers; controllers still in ops)
  documents/          (done — helpers and selects; orchestration still in ops)
  orders/             ← legacy transport/orders module at transport root (future rename)
  driver-app/         ← ops driver-home, driver-jobs, driver-trips (future)
  driver-legacy/      ← src/driver (future, after untangling shared exports)
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
  audit/              (done)
  health/             (done)
  places/             (done)
  users/              (done)
  auth/               (future)
  tenants/            (future)
  prisma/             (future)
  realtime/           (future)
  notifications/      (future)
  push/               (future)
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
- **One domain per folder** over time; `ops` remains the current transport job/trip execution home until service extraction is planned.
