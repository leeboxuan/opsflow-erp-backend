-- Additive Platform Super Admin Phase 1 schema.
-- Safe for existing data: Tenant.status defaults ACTIVE; backfill PlatformAdmin from SUPERADMIN.
-- Do NOT apply to production from agent workflows — create file only; operators run migrate deploy.

-- Enums
CREATE TYPE "TenantStatus" AS ENUM ('SETUP', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "TenantModule" AS ENUM ('TRANSPORT', 'WAREHOUSING', 'FINANCE');
CREATE TYPE "PlatformAdminStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- Tenant lifecycle (existing rows → ACTIVE)
ALTER TABLE "tenants" ADD COLUMN "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE';

-- PlatformAdmin identity (not a tenant Role)
CREATE TABLE "platform_admins" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "PlatformAdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT,
    "notes" TEXT,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_admins_userId_key" ON "platform_admins"("userId");
CREATE INDEX "platform_admins_status_idx" ON "platform_admins"("status");

ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Module entitlements
CREATE TABLE "tenant_module_entitlements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "module" "TenantModule" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_module_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_module_entitlements_tenantId_module_key"
  ON "tenant_module_entitlements"("tenantId", "module");
CREATE INDEX "tenant_module_entitlements_tenantId_idx"
  ON "tenant_module_entitlements"("tenantId");

ALTER TABLE "tenant_module_entitlements"
  ADD CONSTRAINT "tenant_module_entitlements_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only platform audit log
CREATE TABLE "platform_audit_logs" (
    "id" TEXT NOT NULL,
    "actorPlatformAdminId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "targetTenantId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "correlationId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_audit_logs_createdAt_idx" ON "platform_audit_logs"("createdAt");
CREATE INDEX "platform_audit_logs_actorPlatformAdminId_createdAt_idx"
  ON "platform_audit_logs"("actorPlatformAdminId", "createdAt");
CREATE INDEX "platform_audit_logs_targetTenantId_createdAt_idx"
  ON "platform_audit_logs"("targetTenantId", "createdAt");
CREATE INDEX "platform_audit_logs_action_createdAt_idx"
  ON "platform_audit_logs"("action", "createdAt");

ALTER TABLE "platform_audit_logs"
  ADD CONSTRAINT "platform_audit_logs_actorPlatformAdminId_fkey"
  FOREIGN KEY ("actorPlatformAdminId") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "platform_audit_logs"
  ADD CONSTRAINT "platform_audit_logs_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "platform_audit_logs"
  ADD CONSTRAINT "platform_audit_logs_targetTenantId_fkey"
  FOREIGN KEY ("targetTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: User.role = SUPERADMIN → PlatformAdmin ACTIVE (additive; no wipe)
INSERT INTO "platform_admins" ("id", "userId", "status", "createdAt", "updatedAt", "notes")
SELECT
  'pa_bf_' || "id",
  "id",
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  'Backfilled from User.role=SUPERADMIN'
FROM "users"
WHERE "role" = 'SUPERADMIN'
ON CONFLICT ("userId") DO NOTHING;
