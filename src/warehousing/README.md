# Warehousing domain

This folder documents the **Warehousing** product domain. It is the target home for warehousing modules as the backend is reorganized to match the frontend.

## What Warehousing owns

Warehousing is responsible for:

- **Inventory** — stock items, batches, units, receive/reserve/dispatch flows
- **Warehouse Jobs** *(future)* — dedicated warehousing work orders, separate from transport execution

## Warehouse Jobs vs Transport Jobs

**Warehouse Jobs and Transport Jobs are different domains.**

| | Transport Jobs | Warehouse Jobs |
|---|----------------|----------------|
| **Purpose** | Trucking/logistics execution (pickup, delivery, driver trips) | Warehouse operations (receiving, putaway, picking, internal handling) |
| **Current backend** | Prisma `Job` / `Trip` in `src/transport` (jobs, trips, driver-app) | **Does not exist yet** |
| **Rule** | Use existing `Job`/`Trip` flows | Must **not** reuse the transport `Job` model or transport job services |

When warehouse jobs are implemented, they should use dedicated `WarehouseJob` (or equivalent) models, services, and routes under this domain—not transport job tables or APIs.

## Inventory module

Inventory code lives at **`src/warehousing/inventory`** (routes: `/inventory/*`). HTTP routes and Nest class names are unchanged from the prior `src/inventory` location.

Inventory today integrates with transport at the data level (e.g. inventory units linked to `TransportOrder` / `Trip` for outbound dispatch). That bridge is an explicit cross-domain integration; it does not make inventory units or batches into transport jobs.

## What not to put here

Do not add transport job logic, trip execution, dispatch board code, or driver mobile job flows into warehousing modules. Those belong to the Transport domain (`src/transport` and related folders).
