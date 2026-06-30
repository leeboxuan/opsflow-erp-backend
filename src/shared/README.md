# Shared infrastructure

## Purpose

`src/shared` contains **cross-domain infrastructure and utilities** used by Transport, Warehousing, Finance, and platform/admin features.

Modules here should be reusable without belonging to a single product domain. Domain-specific business rules belong under `src/transport` (including `transport/finance`), `src/warehousing`, or their subfolders — not in shared.

## Current contents

| Path | Role | Routes (examples) |
|------|------|-------------------|
| `auth/` | Supabase auth, JWT verification, guards (`AuthGuard`, `TenantGuard`, `RoleGuard`) | `/auth/*` |
| `prisma/` | Prisma client module (`PrismaService`) | (no HTTP routes) |
| `tenants/` | Multi-tenancy and membership APIs | `/tenants/*` |
| `realtime/` | SSE / realtime event bus (`RealtimeEventsService`) | `/realtime/*` |
| `notifications/` | In-app notifications fan-out | `/notifications/*` |
| `push/` | Expo push for drivers | `/push/devices/*` |
| `places/` | Google Places autocomplete and geocoding helpers | `/places/*` |
| `health/` | Health and tenant-context probe endpoints | `/health/*` |
| `audit/` | Cross-domain audit logging (`AuditService`; no HTTP routes) | — |
| `users/` | Authenticated user profile and avatar APIs | `/users/me`, `/users/me/avatar` |

## Module dependencies (platform)

- `AuthModule` imports `PrismaModule`
- `TenantsModule` imports `PrismaModule`, `AuthModule`
- `RealtimeModule` imports `AuthModule`, `NotificationsModule` (with `forwardRef`)
- `NotificationsModule` imports `PrismaModule`, `AuthModule`, `RealtimeModule`, `PushModule`
- `PushModule` imports `PrismaModule`, `AuthModule`

`AppModule` wires these from `./shared/<module>/<module>.module`.

## Future candidates

- `common/` — only utilities that are genuinely cross-domain (transport- or warehousing-specific helpers should move out of `common` over time)

## Rules

**Do not put Transport-specific or Warehousing-specific business logic in shared.**

Shared is for:

- Infrastructure and platform services (auth, tenancy, database client, health)
- Cross-cutting delivery (realtime, notifications, push)
- Generic helpers (pagination, listing, geo/places) with no domain workflow

It is **not** for:

- Transport jobs, trips, dispatch, or driver execution
- Inventory, warehouse jobs, or stock workflows
- Domain invoicing or charge selection tied to transport or warehouse jobs

## Finance note

Transport finance lives under `src/transport/finance/`. Warehouse finance will live under `src/warehousing/finance/`. Generic billing primitives (if ever needed) under `src/shared/billing/` — not created yet.
