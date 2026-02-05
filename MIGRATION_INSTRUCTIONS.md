# Migration Instructions: Moving API to Separate Repo

This folder (`_export_api/`) contains all the backend code needed to run the NestJS API in a standalone repository.

## Step 1: Create New Repository

Create a new GitHub repository called `opsflow-erp-api` (or your preferred name).

## Step 2: Copy `_export_api/` Contents

Copy all contents from this `_export_api/` folder to the root of your new repository.

```bash
# From the new opsflow-erp-api repo root:
cp -r /path/to/cargo-erp/_export_api/* .
```

Or using Windows PowerShell:
```powershell
# From the new opsflow-erp-api repo root:
Copy-Item -Path "C:\path\to\cargo-erp\_export_api\*" -Destination . -Recurse -Force
```

## Step 3: Install Dependencies

```bash
pnpm install
```

This will install all NestJS and Prisma dependencies.

## Step 4: Set Up Environment Variables

1. Create `.env.local` in the repo root with your actual values:
   - `DATABASE_URL`: Your PostgreSQL connection string
   - `SUPABASE_PROJECT_URL` or `SUPABASE_PROJECT_REF`: Your Supabase project reference
   - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key
   - `WEB_APP_URL`: Frontend URL for CORS (default: http://localhost:3000)
   - `PORT`: API server port (default: 3001)

## Step 5: Generate Prisma Client

```bash
pnpm prisma:generate
```

This generates the Prisma Client based on the schema in `prisma/schema.prisma`.

## Step 6: Run Database Migrations

If this is a new database:
```bash
pnpm prisma:migrate
```

If you're deploying to production:
```bash
pnpm prisma:migrate:deploy
```

## Step 7: (Optional) Seed Database

If you want to seed the database with initial data:
```bash
SUPABASE_USER_EMAIL=user@example.com pnpm prisma:seed
```

## Step 8: Start Development Server

```bash
pnpm dev
```

The API will be available at `http://localhost:3001` (or the port specified in `.env.local`).

All routes are prefixed with `/api` (e.g., `GET /api/health`, `GET /api/auth/me`).

## Verification

Test that the API is running:

```bash
# Health check (no auth required)
curl http://localhost:3001/api/health

# Auth check (requires JWT token and X-Tenant-Id header)
curl -H "Authorization: Bearer <token>" \
     -H "X-Tenant-Id: <tenant-id>" \
     http://localhost:3001/api/auth/me
```

## Production Build

To build for production:

```bash
pnpm build
pnpm start:prod
```

## What Changed from Monorepo

### Import Changes

All imports have been updated from workspace dependencies to npm packages:

- `@cargo-erp/db` → `@prisma/client`
- All Prisma types and enums now come directly from `@prisma/client`

### Package Structure

- Prisma schema and migrations are now in `prisma/` at the repo root (not in a separate package)
- All backend modules are in `src/`
- No frontend code or React dependencies

### Scripts

- `pnpm dev` - Development server (was `pnpm dev:api` in monorepo)
- `pnpm build` - Build for production
- `pnpm start:prod` - Run production build
- `pnpm prisma:generate` - Generate Prisma Client
- `pnpm prisma:migrate` - Run database migrations

## Important Notes

1. **Database**: Ensure your `DATABASE_URL` points to the same database (or migrate data if using a new one).

2. **Supabase**: The API still uses Supabase for authentication. Make sure `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_PROJECT_URL` are correctly configured.

3. **CORS**: Update `WEB_APP_URL` in production to match your frontend deployment URL.

4. **No Workspace Dependencies**: This repo is standalone and does not depend on the monorepo workspace packages. All dependencies are installed via `pnpm install`.

## Next Steps

After successfully setting up the API repo:

1. Update frontend (cargo-erp/opsflow-erp-web) to point API calls to the new API deployment URL
2. Update CI/CD pipelines if you have any
3. Remove `services/api/` from the original monorepo (optional, after confirming everything works)
