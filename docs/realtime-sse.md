# OpsFlow Realtime SSE

Metadata-only Server-Sent Events for cache invalidation. Not a replacement for REST APIs or Supabase Realtime.

## 1. Endpoint

```
GET /api/realtime/events
```

Build the URL from `API_BASE_URL` (see [§7 Troubleshooting](#7-troubleshooting)).

## 2. Required headers

```
Authorization: Bearer <token>
X-Tenant-Id: <tenantId>
```

The user must have an **active** membership in that tenant.

## 3. Client requirements

- Use **fetch streaming** (web) or **React Native XHR** (or any SSE client that supports custom headers).
- **Do not use native `EventSource`** — it cannot send `Authorization` or `X-Tenant-Id`.
- **Heartbeat** (every ~25s):

  ```json
  { "type": "heartbeat" }
  ```

  Ignore heartbeats; do not invalidate queries.
- **Data events** are **metadata only** (ids + type), not full DB records.
- On each non-heartbeat event, **invalidate/refetch** the relevant queries (see [§5](#5-event-type--client-invalidation-matrix)).
- **Do not** read signed document URLs from SSE. After `document.*`, invalidate document queries and fetch signed URLs via existing REST `signed-url` endpoints only.

**Minimal handler**

```ts
function handleSseDataLine(raw: string) {
  if (!raw) return;
  let msg: { type: string; jobId?: string; tripId?: string; driverUserId?: string };
  try {
    msg = JSON.parse(raw);
  } catch {
    return; // skip non-JSON lines
  }
  if (msg.type === "heartbeat") return;
  invalidateFromRealtimeEvent(msg);
}
```

## 4. Event payload shape

```ts
{
  type: string;
  tenantId: string;
  entityType:
    | "job"
    | "trip"
    | "document"
    | "driver"
    | "vehicle"
    | "customer"
    | "dispatch"
    | "dashboard";
  entityId?: string;
  jobId?: string;
  tripId?: string;
  driverUserId?: string; // app user id (public.users.id), same as mobile req.user.userId
  changedAt: string;       // ISO-8601
  reason?: string;
}
```

**Note:** `invoice.created` / `invoice.updated` / `invoice.generated` use `type` prefix `invoice.*` but `entityType` is currently `"dashboard"` with `entityId` = invoice id. Key off `type`, not only `entityType`.

**Example**

```json
{
  "type": "trip.assigned",
  "tenantId": "tenant_1",
  "entityType": "trip",
  "entityId": "trip_1",
  "jobId": "job_1",
  "tripId": "trip_1",
  "driverUserId": "user_1",
  "changedAt": "2026-05-21T08:00:00.000Z"
}
```

## 5. Event type → client invalidation matrix

Match on `type` (supports wildcards mentally: `job.*`, `trip.*`, etc.). Prefer narrow invalidation when `jobId` / `tripId` / `driverUserId` are present.

### `job.*`

| Client | Invalidate / refetch |
|--------|----------------------|
| **Web** | `jobs`, `dashboardSummary`, job detail when `jobId` is set |
| **Mobile driver** | Usually ignore; rely on `driver.active-jobs.updated` when the backend emits it |

### `trip.*`

| Client | Invalidate / refetch |
|--------|----------------------|
| **Web** | `jobs`, `dispatch-board`, `dashboardSummary`, job detail, `job-trips`, trip detail when ids present |
| **Mobile driver** | Active jobs, trip detail, completion requirements when `driverUserId` matches the logged-in driver |

### `document.*`

| Client | Invalidate / refetch |
|--------|----------------------|
| **Web** | `job-documents`, job detail, `job-trips` / trip when `tripId` present |
| **Mobile driver** | Active jobs, trip detail, completion requirements when relevant |
| **Both** | Do **not** auto-fetch signed URLs from SSE |

### `driver.*` (admin roster: `driver.created`, `driver.updated`, …)

| Client | Invalidate / refetch |
|--------|----------------------|
| **Web** | `drivers`, `dispatch-board` |
| **Mobile driver** | N/A (admin events are filtered out for DRIVER role) |

### `vehicle.*`

| Client | Invalidate / refetch |
|--------|----------------------|
| **Web** | `vehicles`, `dispatch-board` |
| **Mobile driver** | Ignore |

### `customer.*`

| Client | Invalidate / refetch |
|--------|----------------------|
| **Web** | `customer-companies`, `jobs` (lists that show customer context) |
| **Mobile driver** | Ignore |

### `invoice.*`

| Client | Invalidate / refetch |
|--------|----------------------|
| **Web** | `dashboardSummary`, `invoices`, job detail when `jobId` is set |
| **Mobile driver** | Ignore |

### `dispatch.updated` / `driver.location.updated`

| Client | Invalidate / refetch |
|--------|----------------------|
| **Web** | `dispatch-board` |
| **Mobile driver** | Only when the event includes **your** `driverUserId` (location is throttled ~12s per driver on the server) |

### `dashboard.updated`

| Client | Invalidate / refetch |
|--------|----------------------|
| **Web** | `dashboardSummary` |
| **Mobile driver** | Not sent to DRIVER role |

### `driver.active-jobs.updated`

| Client | Invalidate / refetch |
|--------|----------------------|
| **Web** | Optional: driver day views on dispatch |
| **Mobile driver** | Active jobs / home — only when `driverUserId` matches logged-in user |

## 6. Role behavior

| Role | SSE access | What you receive |
|------|------------|------------------|
| **ADMIN**, **OPS**, **FINANCE** | Yes | Tenant ops events for `X-Tenant-Id` |
| **DRIVER** | Yes | Only own `trip.*`, `document.*`, `driver.active-jobs.updated`, `driver.location.updated`, and `dispatch.updated` when scoped with your `driverUserId` |
| **CUSTOMER** | **No** (403) | Stream not supported yet |

`driverUserId` in events must match the authenticated app user id (`Authorization` → `userId`), same id used on driver REST APIs and `Trip.assignedDriverUserId`.

## 7. Troubleshooting

| Issue | What to check |
|-------|----------------|
| **401** | Token missing, expired, or invalid. Refresh session. |
| **403** | Not a member of `X-Tenant-Id`, suspended account, **CUSTOMER** role, or role not in ADMIN/OPS/FINANCE/DRIVER. |
| **Wrong URL** | If `API_BASE_URL` already includes `/api` → `{API_BASE_URL}/realtime/events`. Otherwise → `{API_BASE_URL}/api/realtime/events`. |
| **Heartbeat breaks `JSON.parse`** | Client is parsing empty or non-JSON lines. Only parse `data:` lines with content; skip parse errors; treat `{ "type": "heartbeat" }` as no-op. |
| **No UI updates** | Backend only publishes **after** successful DB writes. Confirm mutation succeeded, event `tenantId` matches connection, and for drivers that `driverUserId` is set on trip/document events. |

## Backend reference

- `src/realtime/realtime.controller.ts` — route + guards  
- `src/realtime/realtime-events.service.ts` — publish + heartbeat  
- `src/realtime/realtime-event-filter.ts` — tenant + role filtering  
