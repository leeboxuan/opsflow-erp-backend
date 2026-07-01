# Warehouse Jobs module

Scaffold for the **Warehouse Jobs** domain under `src/warehousing/warehouse-jobs`.

## Domain separation

**Warehouse Jobs and Transport Jobs are separate domains.**

- Transport execution uses Prisma `Job`, `Trip`, and `Stop` under `src/transport`.
- Warehouse Jobs use dedicated Prisma models: `WarehouseJob`, `WarehouseJobLine`, `WarehouseJobUnit`, `WarehouseJobEvent`, and `warehouse_job_internal_ref_counters`.
- **Do not** reuse transport `Job` / `Trip` / `Stop` models, services, or routes.
- **Do not** import from `src/transport` (jobs, trips, workflows, driver-app, legacy-driver, etc.).

## Data model

| Table | Purpose |
|-------|---------|
| `warehouse_jobs` | Header: type, status, priority, customer/batch context, assignment |
| `warehouse_job_lines` | Planned work lines (SKU/batch, requested/completed qty) |
| `warehouse_job_units` | Join table linking inventory units to a job (PLANNED → CONFIRMED → RELEASED) |
| `warehouse_job_events` | Immutable audit trail |
| `warehouse_job_internal_ref_counters` | Tenant-scoped ref sequence (`WH-{YYYY}-{MM}-{seq4}`) |

**Important:** `inventory_units` must **not** receive `warehouseJobId` or `warehouseJobLineId` scalar columns. Unit association is exclusively via `WarehouseJobUnit`.

## Services (planned split)

| Service | Responsibility |
|---------|----------------|
| `WarehouseJobsService` | Facade: list/get/create/update |
| `WarehouseJobLifecycleService` | Status transitions, internal ref allocation, cancel |
| `WarehouseJobLinesService` | Line CRUD |
| `WarehouseJobUnitsService` | Link / confirm / release units |
| `WarehouseJobEventsService` | Append audit events |
| `WarehouseInventoryBridgeService` | Read-only inventory validation; future inventory mutations |

## Routes

Prefix: `/warehouse-jobs` (guarded by `AuthGuard`, `TenantGuard`, and `RoleGuard`).

| Method | Path | Roles |
|--------|------|-------|
| POST | `/warehouse-jobs` | ADMIN, OPS |
| GET | `/warehouse-jobs` | ADMIN, OPS, FINANCE |
| GET | `/warehouse-jobs/:id` | ADMIN, OPS, FINANCE |
| PATCH | `/warehouse-jobs/:id` | ADMIN, OPS |
| POST | `/warehouse-jobs/:id/open` | ADMIN, OPS |
| POST | `/warehouse-jobs/:id/start` | ADMIN, OPS |
| POST | `/warehouse-jobs/:id/complete` | ADMIN, OPS |
| POST | `/warehouse-jobs/:id/cancel` | ADMIN, OPS |
| GET | `/warehouse-jobs/:id/lines` | ADMIN, OPS, FINANCE |
| POST | `/warehouse-jobs/:id/lines` | ADMIN, OPS |
| PATCH | `/warehouse-jobs/:id/lines/:lineId` | ADMIN, OPS |
| DELETE | `/warehouse-jobs/:id/lines/:lineId` | ADMIN, OPS |
| GET | `/warehouse-jobs/:id/units` | ADMIN, OPS, FINANCE |
| POST | `/warehouse-jobs/:id/units` | ADMIN, OPS |
| POST | `/warehouse-jobs/:id/units/confirm` | ADMIN, OPS |
| POST | `/warehouse-jobs/:id/units/release` | ADMIN, OPS |
| POST | `/warehouse-jobs/:id/lines/:lineId/units` | ADMIN, OPS |
| POST | `/warehouse-jobs/:id/lines/:lineId/units/confirm` | ADMIN, OPS |
| POST | `/warehouse-jobs/:id/lines/:lineId/units/release` | ADMIN, OPS |

Line mutations are allowed only when the parent job is **DRAFT** or **OPEN**.

Unit link/release mutations are allowed when the parent job is **DRAFT**, **OPEN**, or **IN_PROGRESS**.

Unit confirm is allowed only when the parent job is **OPEN** or **IN_PROGRESS**.

## Unit link statuses

`WarehouseJobUnit.linkStatus` workflow:

| Status | Meaning |
|--------|---------|
| `PLANNED` | Unit linked to job (default on link) |
| `CONFIRMED` | Unit confirmed for warehouse work |
| `RELEASED` | Unit released from job planning (row retained) |

**Important:** This pass only writes the `warehouse_job_units` join table. It does **not** mutate `inventory_units.status` or any transport fields (`transportOrderId`, `tripId`, `stopId`). Warehouse job unit logic never touches `transport_order_items` or `transport_order_item_units`.

`WarehouseJobLine.completedQty` is recalculated from CONFIRMED `warehouse_job_units` rows for that line on unit confirm/release. Job-level unit links (no `warehouseJobLineId`) do not affect line quantities.

## Job completion

### Auto-completion

After unit **confirm** recalculates line `completedQty`, `WarehouseJobLifecycleService.maybeAutoCompleteJob` runs inside the same transaction:

- Only when parent job status is **IN_PROGRESS**.
- Requires at least one line with `requestedQty > 0`.
- Requires **every** line to satisfy `completedQty >= requestedQty`.
- Jobs with **zero lines** are not auto-completed.
- On success: sets status **COMPLETED**, sets `completedAt` (if empty), appends **STATUS_CHANGED** (`IN_PROGRESS` → `COMPLETED`).
- Unit **release** does not auto-complete and does not reopen completed jobs.

### Manual complete (`POST /warehouse-jobs/:id/complete`)

- **Header-only jobs** (no lines): allowed from **IN_PROGRESS**.
- **Jobs with lines**: rejected with `BadRequestException` unless every line has `completedQty >= requestedQty`.
- Does not mutate `inventory_units` or transport tables.

### Terminal jobs

**COMPLETED** and **CANCELLED** jobs remain terminal. Unit link/confirm/release mutations are blocked by existing status rules.

DRIVER and CUSTOMER roles are blocked at the controller level.

## WAREHOUSE role (floor/mobile users)

Internal warehouse floor/mobile users use the **`WAREHOUSE`** tenant membership role. They authenticate via the same JWT/TenantGuard flow as other users — **not** legacy `/driver/*` APIs.

### Access policy (v1)

| Scenario | WAREHOUSE access |
|----------|------------------|
| Job `assignedToUserId` = current user | Full floor access (read, docs, execution, start/complete) |
| Job unassigned + status `OPEN` or `IN_PROGRESS` | Open queue: read, upload photos, execution, start/complete |
| Other statuses (e.g. `DRAFT`, `COMPLETED`) unless assigned | Blocked |

**List filter:** `assignedToUserId = me` OR (`assignedToUserId` is null AND status IN `OPEN`, `IN_PROGRESS`).

### WAREHOUSE allowed routes

| Method | Path |
|--------|------|
| GET | `/warehouse-jobs` |
| GET | `/warehouse-jobs/:id` |
| GET | `/warehouse-jobs/:id/documents` |
| POST | `/warehouse-jobs/:id/documents` |
| PATCH | `/warehouse-jobs/:id/execution` |
| POST | `/warehouse-jobs/:id/start` |
| POST | `/warehouse-jobs/:id/complete` |

### WAREHOUSE blocked routes

- Job/lines header CRUD and lifecycle cancel/open
- Line and unit mutations
- Document metadata edit, delete, approve, reject
- Transport, finance, driver APIs

## Execution fields

| Field | Purpose |
|-------|---------|
| `containerNumber` | Floor-entered container reference |
| `sealNumber` | Seal identifier |
| `warehouseNotes` | Operational notes from warehouse floor (separate from admin `notes`) |

`PATCH /warehouse-jobs/:id/execution` — roles: ADMIN, OPS, WAREHOUSE (with access policy above). Rejected when job is `COMPLETED` or `CANCELLED`.

## Documents

### Types (`WarehouseJobDocumentType`)

| Type | Typical uploader |
|------|------------------|
| `PACKING_LIST` | ADMIN/OPS |
| `DELIVERY_ORDER` | ADMIN/OPS |
| `INSTRUCTION` | ADMIN/OPS |
| `REFERENCE_PHOTO` | ADMIN/OPS |
| `WAREHOUSE_PHOTO` | WAREHOUSE |
| `DAMAGE_PHOTO` | WAREHOUSE |
| `COMPLETION_PHOTO` | WAREHOUSE |
| `OTHER` | All (WAREHOUSE: floor misc) |

### Upload/review lifecycle

1. Upload → `reviewStatus = PENDING_REVIEW`, `source` from role (ADMIN/OPS/WAREHOUSE).
2. ADMIN/OPS **approve** → `APPROVED`, `reviewedAt`, `reviewedByUserId`.
3. ADMIN/OPS **reject** → `REJECTED`, `rejectedReason`, `reviewedAt`, `reviewedByUserId`.

Storage: Supabase bucket `warehouse-job-documents` (tenant-scoped keys). Hard delete removes DB row; storage object cleanup is TODO.

### Document routes

| Method | Path | Roles |
|--------|------|-------|
| GET | `/warehouse-jobs/:id/documents` | ADMIN, OPS, FINANCE, WAREHOUSE |
| POST | `/warehouse-jobs/:id/documents` | ADMIN, OPS, WAREHOUSE |
| PATCH | `/warehouse-jobs/:id/documents/:documentId` | ADMIN, OPS |
| DELETE | `/warehouse-jobs/:id/documents/:documentId` | ADMIN, OPS |
| POST | `.../approve` | ADMIN, OPS |
| POST | `.../reject` | ADMIN, OPS |

**No transport document reuse.** Warehouse documents use `warehouse_job_documents` only.

**No inventory status mutation** from document or execution flows.

**Report PDF generation** is a future phase.

## Audit events (header + lifecycle)

- **CREATED** on create.
- **STATUS_CHANGED** on every lifecycle transition (`fromStatus` / `toStatus`).
- **CANCELLED** additionally when cancel includes a reason (payload `{ reason }`).
- **ASSIGNED** when `assignedToUserId` changes on update.
- **NOTE_ADDED** when `notes` changes on update.
- **LINE_ADDED** / **LINE_UPDATED** / **LINE_REMOVED** on line CRUD.
- **UNIT_LINKED** / **UNIT_CONFIRMED** / **UNIT_RELEASED** on unit workflow.
- **DOCUMENT_UPLOADED** / **DOCUMENT_UPDATED** / **DOCUMENT_DELETED** / **DOCUMENT_APPROVED** / **DOCUMENT_REJECTED** on document workflow.
- **EXECUTION_UPDATED** on execution field changes.

## WarehouseInventoryBridgeService

`WarehouseInventoryBridgeService` is the **only** future place where warehouse-jobs may coordinate inventory changes. All inventory reads and (future) writes for warehouse work must flow through this service — not through transport services or ad-hoc Prisma calls in unit/line handlers.

### Current v1 behavior (read-only, conservative)

- **WarehouseJobUnit** link / confirm / release only changes `warehouse_job_units`.
- **WarehouseJobLine.completedQty** sync only changes `warehouse_job_lines`.
- **`inventory_units.status` is not changed** by Warehouse Jobs in v1.
- Bridge helpers perform **tenant-scoped reads only** (items, batches, batch membership, units). They do not call `inventory_units.update` / `updateMany`.

### Inventory status transition policy (v1)

**v1 Warehouse Jobs are operational work-order tracking.** They record planned work, unit links, and line completion via `warehouse_job_units` — not inventory ledger changes.

- **`InventoryService`** (`src/warehousing/inventory`) remains the current authority for `inventory_units.status` changes (e.g. stock-in, manual status updates).
- **`WarehouseInventoryBridgeService`** remains **read-only** until product-specific transition DTOs exist per job type.
- Unit **confirm** and job **complete** (manual or auto) do **not** change `inventory_units.status` in v1.
- Any future mutation must be explicit per job type, tenant-scoped, audited via `WarehouseJobEvent`, and must **never** write transport fields.

Existing `InventoryUnitStatus` values include transport-facing states (`Reserved`, `Dispatched`, `InTransit`, `Delivered`). Warehouse Jobs must **not** casually map pick/confirm workflows to those statuses. PICK confirmation ≠ transport `Reserved`.

#### Per-type policy (`WarehouseJobType`)

| Type | Confirm changes `inventory_units.status` (v1) | Job complete changes status (v1) | Validation before any future mutation | New statuses needed later? | Deferred? |
|------|-----------------------------------------------|----------------------------------|---------------------------------------|----------------------------|-----------|
| `RECEIVE` | No | No | Tie to existing stock-in / receive flow; item-in-batch; tenant scope | Maybe (`Quarantined`) | Yes — use `InventoryService` stock-in until warehouse receive DTO is designed |
| `PUTAWAY` | No | No | Warehouse locations/bins; unit available; item-in-batch | Yes (`PutawayPending`) | Yes — no bin/location model yet |
| `PICK` | No | No | Line item/batch match; unit not on active transport job; tenant scope | Yes (`Picked`) | Yes — pick confirm must not set transport `Reserved` |
| `PACK` | No | No | Picked or available units per product rule; line compatibility | Yes (`Packed`) | Yes |
| `STOCK_ADJUSTMENT` | No | No | Admin-only; reason code DTO; approval workflow | Yes (`AdjustmentPending`) | Yes — needs reason-coded mutation DTO |
| `RETURN_PROCESSING` | No | No | Explicit outcome: Available / Damaged / Returned; RMA context | Maybe (reuse `Returned`/`Damaged` carefully) | Yes — needs outcome DTO |
| `INTERNAL_MOVE` | No | No | Source/target bin or location; unit tenant scope | Maybe (`PutawayPending`) | Yes — no bin/location model yet |
| `CYCLE_COUNT` | No | No | Record discrepancy before mutation; count session context | Yes (`Counted`) | Yes — discrepancy recording not implemented |

#### Future guardrails (implemented, not wired to confirm/complete yet)

Any future bridge method that **mutates** inventory must call these first:

| Method | Purpose |
|--------|---------|
| `assertWarehouseJobTypeCanMutateInventory` | Rejects all types in v1 until per-type DTOs are approved |
| `assertNoTransportInventoryFieldsInMutationPayload` | Rejects `transportOrderId`, `tripId`, `stopId` in write payloads |

**Warning:** Bridge methods may read inventory tables now. Mutation paths must invoke both guardrails before writing `inventory_units` or related tables.

#### Proposed future warehouse-specific statuses (schema not changed)

Evaluate adding to `InventoryUnitStatus` only after product sign-off — **do not migrate in v1**:

| Proposed status | Likely use |
|-----------------|------------|
| `PutawayPending` | Received, awaiting putaway |
| `Picked` | Picked for outbound warehouse job (not transport reserve) |
| `Packed` | Packed, ready for dispatch handoff |
| `Quarantined` | Hold / QC / receive quarantine |
| `Counted` | Cycle-count verified (discrepancy workflow may follow) |
| `AdjustmentPending` | Stock adjustment awaiting approval |

Reuse existing `Available`, `Damaged`, `Returned` where semantics align; avoid overloading transport-facing `Reserved` / `Dispatched` / `InTransit` / `Delivered`.

### Hard prohibitions (now and future)

`WarehouseInventoryBridgeService` must **never** write:

- `inventory_units.transportOrderId`
- `inventory_units.tripId`
- `inventory_units.stopId`
- `transport_order_items`
- `transport_order_item_units`

### Read-only helpers (v1)

| Method | Purpose |
|--------|---------|
| `assertInventoryItemBelongsToTenant` | Item exists for tenant |
| `assertInventoryBatchBelongsToTenant` | Batch exists for tenant |
| `assertItemBelongsToBatch` | Row in `inventory_batch_items` for tenant + batch + item |
| `resolveInventoryUnitsForTenant` | Resolve units by id/SKU (deduplicated) |
| `assertLineInventoryCompatibility` | Unit item/batch matches line; item-in-batch when both set |
| `assertWarehouseJobTypeCanMutateInventory` | Future: gate per-type inventory mutations (v1 rejects all) |
| `assertNoTransportInventoryFieldsInMutationPayload` | Future: block transport fields in mutation payloads |

Line create/update and unit link call the read-only helpers when both `inventoryItemId` and `inventoryBatchId` are present.

## Future scope (not in scaffold)

- Per-type inventory status transitions (after product DTOs and optional new enum values)
- Barcode / WMS scanning workflows
- Realtime, notifications, push
- Warehouse finance → planned under `src/warehousing/finance`
- Full CRUD and status database logic

## Related

- Inventory module: `src/warehousing/inventory` (`/inventory/*`) — unchanged by this scaffold
- Warehousing domain overview: `src/warehousing/README.md`
