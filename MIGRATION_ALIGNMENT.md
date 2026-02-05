# Aligning this repo’s migrations with Supabase

Your Supabase DB was migrated from **cargo-erp** (different migration names). This repo has its own migration set. To get Prisma and the DB in sync, use one of the two approaches below.

---

## Path A – Keep this repo’s schema (recommended first)

**Idea:** Tell Prisma that **all migrations in this repo are already applied** on the DB, without running their SQL. Use this if the DB already has the tables/columns this app needs (possibly created by cargo-erp under different migration names).

### 1. Clear Prisma’s migration history on the DB

In **Supabase** → **SQL Editor**, run:

```sql
DELETE FROM _prisma_migrations;
```

### 2. Mark this repo’s migrations as applied

From the project root (with `.env.local` loaded):

```powershell
pnpm exec dotenv -e .env.local -- prisma migrate resolve --applied 20260115192023_init
pnpm exec dotenv -e .env.local -- prisma migrate resolve --applied 20260115212052_init
pnpm exec dotenv -e .env.local -- prisma migrate resolve --applied 20260117064622_add_vehicles_and_trip_assignments
pnpm exec dotenv -e .env.local -- prisma migrate resolve --applied 20260118063154_add_driver_locations
pnpm exec dotenv -e .env.local -- prisma migrate resolve --applied 20260203201911_driver_mvp_models
pnpm exec dotenv -e .env.local -- prisma migrate resolve --applied 20260204000000_driver_mvp_models
pnpm exec dotenv -e .env.local -- prisma migrate resolve --applied 20260204120000_transport_order_do_price_contact
```

Or in one go (PowerShell):

```powershell
$migrations = @(
  "20260115192023_init",
  "20260115212052_init",
  "20260117064622_add_vehicles_and_trip_assignments",
  "20260118063154_add_driver_locations",
  "20260203201911_driver_mvp_models",
  "20260204000000_driver_mvp_models",
  "20260204120000_transport_order_do_price_contact"
)
foreach ($m in $migrations) {
  pnpm exec dotenv -e .env.local -- prisma migrate resolve --applied $m
}
```

### 3. Check status

```powershell
pnpm prisma:migrate:status
```

You should see something like: **“Database schema is up to date!”**

### 4. If the app fails at runtime

The DB might be missing columns or tables this schema expects (e.g. `users.auth_user_id`, `driver_location_latest`). Then either:

- Add the missing columns/tables in Supabase (by hand or by running the SQL from this repo’s migration files), or  
- Switch to **Path B** and align the app to the DB schema.

---

## Path B – Use the DB as source of truth (baseline)

**Idea:** Make Prisma’s history match the **current DB schema** with a single “baseline” migration. After this, `schema.prisma` will reflect what’s actually in the DB (from cargo-erp). You’ll need to update the app if it expects different tables/columns (e.g. `User.authUserId`, `DriverLocationLatest`, different Trip/TransportOrder fields).

### 1. Backup and reset

```powershell
# Backup current schema and migrations
Copy-Item prisma\schema.prisma prisma\schema.prisma.backup
Move-Item prisma\migrations prisma\migrations_old
```

### 2. Pull current DB schema

```powershell
pnpm exec dotenv -e .env.local -- prisma db pull
```

This overwrites `prisma/schema.prisma` with the DB’s schema.

### 3. Create baseline migration

```powershell
New-Item -ItemType Directory -Path prisma\migrations\0_init -Force
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script | Out-File -FilePath prisma\migrations\0_init\migration.sql -Encoding utf8
```

### 4. Clear Prisma’s migration history on the DB

In **Supabase** → **SQL Editor**:

```sql
DELETE FROM _prisma_migrations;
```

### 5. Mark the baseline as applied

```powershell
pnpm exec dotenv -e .env.local -- prisma migrate resolve --applied 0_init
```

### 6. Regenerate client and verify

```powershell
pnpm prisma:generate
pnpm prisma:migrate:status
```

### 7. Update the app

The pulled schema will have different models/fields (e.g. `drivers`, `inventory_items`, `UserRole`, different Trip/TransportOrder columns). Update your NestJS code and DTOs to use the new schema. You can compare `prisma/schema.prisma` with `prisma/schema.prisma.backup` to see the diff.

---

## Summary

| Path | When to use |
|------|---------------------|
| **A** | DB already has (or can have) the same shape as this repo’s schema; you want to keep the app as-is and only fix migration history. |
| **B** | You’re okay changing the app to match the current DB (cargo-erp schema); you want one clean baseline and future migrations only in this repo. |

After either path, `pnpm prisma:migrate:status` should report the database in sync with the migrations in this repo.
