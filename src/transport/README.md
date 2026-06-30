# Transport domain

This folder is part of the **Transport** product domain. It holds the legacy transport-orders stack (`/transport/orders`, `/transport/trips`, `/transport/stops`), **dispatch** (`/dispatch`), and other transport submodules consolidated here gradually.

## What Transport owns

Transport is responsible for:

- **Customers** — customer companies, contacts, and company documents
- **Drivers** — driver profiles, admin driver management, and driver mobile execution APIs
- **Vehicles** — tenant vehicle records
- **Fleet** — fleet vehicles, fleet list aliases, and fleet operations
- **Transport Jobs** — job-centric workflows (LCL, IMPORT, EXPORT, COLLECTION); shared helpers and import DTOs in `src/transport/jobs` (e.g. job invoice readiness, job batch import, `dto/import-job-row`, `dto/lcl-import`)
- **Trips** — trip execution, routing, documents, and payouts tied to transport jobs or legacy transport orders; shared helpers in `src/transport/trips` (e.g. trip notes, trip document list)
- **Dispatch** — dispatch board, route planning, and trip reordering (`src/transport/dispatch`)
- **Fleet Tracking** — chassis/GPS devices, live positions, and device-gateway ingestion
- **Documents** — job/trip document and signature helpers in `src/transport/documents` (e.g. signature PDF layout, document uploader utilities)
- **Master Rates** — quotations, trucking rates, DHC references, and driver trip rate masters

## Transport jobs and trips

Existing Prisma `Job` and `Trip` models and their API flows are **transport-only**. They represent trucking/logistics execution (pickup, delivery, multi-leg trips, driver assignment, POD, invoicing handoff).

Do **not** add warehouse job logic, warehouse workflows, or inventory-fulfillment job flows into this domain or into transport `Job`/`Trip` code paths.

## Related code outside this folder

Today, much of the transport domain still lives elsewhere:

| Current location | Role |
|------------------|------|
| `src/ops` | Transport jobs, trips, and driver execution (see `src/ops/README.md`) |
| `src/transport/dispatch` | Dispatch board and route APIs (`/dispatch`) |
| `src/transport/jobs` | Transport job helpers and import DTOs (`dto/`); consumed by `src/ops` and Finance |
| `src/transport/trips` | Trip-level helpers (trip notes, trip document list; consumed by `src/ops`) |
| `src/transport/documents` | Document/signature helpers (signature PDF layout, document uploader; consumed by `src/ops`) |
| `src/transport/customers` | Customer master data |
| `src/drivers`, `src/driver` | Driver admin and mobile APIs |
| `src/transport/vehicles`, `src/transport/fleet/vehicles` | Vehicles and fleet vehicles |
| `src/transport/fleet/tracking`, `src/transport/fleet/device-gateway` | GPS tracking |
| `src/transport/master-rates` | Master rates and reference data |

New transport features should prefer `src/transport` (or subfolders added under it during refactors). Legacy modules will be moved here incrementally without changing routes or behavior in a single step.

## Warehousing boundary

**Warehouse Jobs** and **Inventory** belong to the Warehousing domain (`src/warehousing`). They are separate product concepts. Inventory may link units to transport orders for outbound delivery, but that is an integration boundary—not a reason to model warehouse work as transport jobs.
