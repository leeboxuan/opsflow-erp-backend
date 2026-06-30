# Ops module (Transport domain)

Despite the generic name, **`src/ops` is the current home of Transport jobs, trips, and driver execution workflows.** Treat everything in this folder as **Transport domain** code. Dispatch code lives under `src/transport/dispatch` but remains wired through `OpsModule` (routes still `/dispatch`).

## What lives here today

| Area | Routes (unchanged during refactors) | Responsibility |
|------|-------------------------------------|----------------|
| Transport jobs | `/jobs` | Job CRUD, charges, documents, imports, invoicing handoff |
| Trips | `/trips`, job-scoped trip APIs | Multi-leg trip execution on transport jobs |
| Dispatch | `/dispatch` | Dispatch board, route optimisation, trip reorder — **code:** `src/transport/dispatch` (registered via `OpsModule`) |
| Driver execution | `/drivers/jobs`, `/drivers/trips`, `/drivers` | Driver mobile and ops-facing job/trip flows |

Core services include `ops-jobs.service.ts` and `driver-jobs.service.ts`. Dispatch is `src/transport/dispatch/dispatch.service.ts`. Job helpers and import DTOs live in `src/transport/jobs/`. Trip helpers live in `src/transport/trips/`. Document helpers (signature PDF layout, document uploader) live in `src/transport/documents/` (imported by ops services). Prisma `Job` and `Trip` (where `jobId` is set) are **transport-only**.

## Domain classification

- **Domain:** Transport (not generic “operations” spanning the whole product)
- **Not in scope:** Warehousing, warehouse jobs, or inventory business logic

Do **not** add new warehousing code, warehouse job handlers, or inventory domain logic inside `src/ops`.

## Relationship to `src/transport`

`src/transport` holds the legacy transport-orders stack (`/transport/orders`, `/transport/trips`, `/transport/stops`). `src/ops` holds the newer job-centric transport stack. Both are Transport domain; they share the `Trip` table with different lifecycles (`jobId` set vs null).

**New transport code** should eventually live under `src/transport` (and subfolders added there during refactors). `src/ops` is legacy/current placement, not the long-term name for this domain.

## Planned refactor (gradual)

Do **not** split or move this module all at once. A safe sequence looks like:

1. Document domain boundaries (this file and sibling READMEs)
2. Move leaf modules with few dependencies (e.g. fleet tracking; dispatch, job/trip/document helpers moved under `src/transport/*`)
3. Extract helpers and smaller services from `ops-jobs.service.ts`
4. Relocate job/trip/workflow code under `src/transport` subfolders while keeping the same Nest module registrations and routes until an explicit cutover

Routes, Prisma schema, and import paths should only change in deliberate, reviewed steps—not as part of bulk folder renames.

## Warehousing boundary

**Warehouse Jobs** are a future Warehousing concept (`src/warehousing`). They must not be implemented by extending transport `Job`, `JobType`, or ops job services. Inventory lives under `src/warehousing/inventory` (Warehousing domain).
