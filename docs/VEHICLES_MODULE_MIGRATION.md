# Vehicles module – migration notes

## Apply the migration

From project root (with `DATABASE_URL` and `DIRECT_URL` set):

```bash
npx prisma migrate deploy
```

Or in development:

```bash
npx prisma migrate dev
```

Migration `20250306130000_vehicle_module_plate_no_type_status`:

- Creates enums `VehicleType` and `VehicleStatus`.
- Renames column `vehicles.vehicleNumber` → `vehicles.plateNo` (data preserved).
- Adds columns `type` (default `VAN`), `status` (default `ACTIVE`), `driverId` (nullable, FK to `users`).
- Drops unique constraint `vehicles_tenantId_vehicleNumber_key` and adds `vehicles_tenantId_plateNo_key`.
- Adds indexes for `(tenantId, status)`, `(tenantId, type)`, `(tenantId, driverId)`.

Existing rows keep their plate (in `plateNo`) and get `type = VAN`, `status = ACTIVE`, `driverId = null`.

## API base path

With the global prefix `api`, vehicle routes are:

- `POST /api/vehicles`
- `GET /api/vehicles` (query: `q`, `status`, `type`, `driverId`, `page`, `pageSize`)
- `GET /api/vehicles/:id`
- `PATCH /api/vehicles/:id`
- `POST /api/vehicles/:id/suspend`
- `POST /api/vehicles/:id/unsuspend`
- `DELETE /api/vehicles/:id`

All require `AuthGuard` + `TenantGuard` and use `req.tenant.tenantId` for tenant scoping.
