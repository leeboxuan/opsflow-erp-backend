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
| [`transport/`](transport/) | **Transport** | Relocated transport support modules and legacy transport-orders stack |
| [`warehousing/`](warehousing/) | **Warehousing** | Inventory and future warehouse jobs |
| [`shared/`](shared/) | **Shared** | Cross-domain infrastructure and generic utilities |
| [`ops/`](ops/) | **Transport** (legacy placement) | Current transport jobs, trips, dispatch, driver mobile execution |
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

Transport support modules moved under this folder. The **legacy transport-orders** Nest module still lives at the `transport/` root (`transport.controller`, `trip.controller`, `pod.controller`, etc.) for `/transport/orders`, `/transport/trips`, and `/transport/stops`.

| Subfolder | Purpose |
|-----------|---------|
| `customers/` | Customer companies, contacts, documents (`/customers/*`, `/customer-companies/*`, `/companies/*`) |
| `master-rates/` | Master rates, quotations, DHC, driver trip rates (`/master/*`) |
| `vehicles/` | Tenant vehicles and fleet list alias (`/vehicles/*`, `/fleet`) |
| `fleet/vehicles/` | Fleet vehicle entity (`/fleet-vehicles/*`) |
| `fleet/tracking/` | Chassis and GPS tracking (`/fleet-tracking/*`) |
| `fleet/device-gateway/` | Internal GPS ingestion (`/internal/device-gateway/*`) |

Transport owns customers, vehicles, fleet, master rates, transport jobs/trips (via `ops`), dispatch, and fleet tracking.

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

Despite the generic name, **`ops/` is the current home of transport jobs, trips, dispatch, and driver mobile execution**. Treat it as **Transport domain** code in its current location.

| Area | Routes (examples) |
|------|-------------------|
| Transport jobs | `/jobs/*` |
| Trips (ops detail) | `/trips/:tripId` |
| Dispatch | `/dispatch/*` |
| Driver home | `/drivers/home` |
| Driver job execution | `/drivers/jobs/*` |
| Driver trip detail | `/drivers/trips/*` |

`ops-jobs.service.ts` is the main job/trip workflow monolith. New **warehousing** logic must not be added here.

---

## Finance (`src/finance/`)

Finance is **transport-heavy today** (job invoicing, driver wallets, portal invoices tied to transport jobs).

**Future architecture:** split into **Transport Finance** and **Warehouse Finance** under their respective domains. Only generic billing primitives or helpers (no job-domain coupling) may eventually live in `shared/`.

---

## Driver modules (legacy split)

Two modules exist for historical reasons:

### `src/driver/` — legacy transport-order mobile API

- Routes: `/driver/*` (singular prefix)
- Stack: `TransportOrder` → `Trip` where `jobId` is null; stops, POD, order inbox
- Also exports `LocationService` and DTOs used by `admin`, `transport`, and `drivers`
- **Do not add new features here**; prefer `ops` driver execution or future `transport/driver-app`

### `src/drivers/` — admin CRUD and driver profile

- Routes: `/admin/drivers/*` (web Drivers page), `/drivers/me` (self-profile)
- **Does not own job execution** — that lives in `ops` at `/drivers/jobs/*` and `/drivers/trips/*`
- Uses `UsersService` from `shared/users` for avatars

`driver/` and `drivers/` should be **untangled and consolidated** only after route usage and shared dependencies (`LocationService`, DTOs) are confirmed.

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

3. **Do not reuse transport `Job` for future warehouse jobs.** Implement dedicated `WarehouseJob` (or equivalent) under `warehousing/` with new schema when ready.

4. **Do not add new warehousing logic into `ops`.** Inventory belongs under `warehousing/inventory`.

5. **Do not add new transport-specific business logic into `shared`.** Shared is for infrastructure, platform services, and generic cross-domain helpers.

6. **Do not add warehouse job logic into `transport/`** or legacy `/driver/*` order flows.

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
  orders/             ← legacy transport/orders module (future)
  jobs/               ← from ops (future)
  trips/              ← from ops (future)
  dispatch/           ← from ops (future)
  driver-app/         ← ops driver-home, driver-jobs, driver-trips (future)
  workflows/          ← ops helpers: signatures, DO, documents (future)
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

- **Move leaf modules first** (inventory, fleet tracking, customers, master-rates).
- **Document before moving** monoliths (`ops`, `driver`).
- **Never change HTTP routes** in a folder-only move.
- **One domain per folder** over time; `ops` is the largest remaining transport concentration.
