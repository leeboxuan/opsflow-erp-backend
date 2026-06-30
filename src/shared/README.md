# Shared infrastructure

## Purpose

`src/shared` contains **cross-domain infrastructure and utilities** used by Transport, Warehousing, Finance, and platform/admin features.

Modules here should be reusable without belonging to a single product domain. Domain-specific business rules belong under `src/transport`, `src/warehousing`, or `src/finance` (or their subfolders), not in shared.

## Current contents

| Path | Role |
|------|------|
| `places/` | Google Places autocomplete and geocoding helpers used by address forms across modules (`/places/*`). |
| `health/` | Health and tenant-context probe endpoints for ops and monitoring (`/health/*`). |
| `audit/` | Cross-domain audit logging service (`AuditService`; no HTTP routes). |
| `users/` | Authenticated user profile and avatar APIs (`/users/me`, `/users/me/avatar`). |

## Future candidates

These modules still live at the `src/` root today and may move under `src/shared/` incrementally (routes and behavior unchanged per move):

- `auth`
- `tenants`
- `prisma`
- `realtime`
- `notifications`
- `push`
- `common` — only utilities that are genuinely cross-domain (transport- or warehousing-specific helpers should move out of `common` over time)

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

Transport finance and warehouse finance should eventually live under their respective domains (`src/finance` may split or nest under domain folders as the product grows).

Only **generic billing primitives or helpers** (e.g. shared money/format utilities with no transport or warehouse job coupling) belong in shared. Job invoicing, wallet flows tied to driver trips, and warehouse billing should stay in domain modules.
