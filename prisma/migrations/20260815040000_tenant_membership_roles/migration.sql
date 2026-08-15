-- Canonical multi-role tenant RBAC.
-- Additive: keep TenantMembership.role (legacy) and backfill TenantMembershipRole rows.
-- Do not drop Role enum values or the legacy column in this migration.

CREATE TYPE "CanonicalTenantRole" AS ENUM (
  'TENANT_ADMIN',
  'TRANSPORT_ADMIN',
  'TRANSPORT_DRIVER',
  'FINANCE_ADMIN',
  'WAREHOUSE_ADMIN',
  'WAREHOUSE_STAFF',
  'CUSTOMER_ADMIN'
);

CREATE TABLE "tenant_membership_roles" (
    "id" TEXT NOT NULL,
    "tenantMembershipId" TEXT NOT NULL,
    "role" "CanonicalTenantRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "tenant_membership_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_membership_roles_tenantMembershipId_role_key"
  ON "tenant_membership_roles"("tenantMembershipId", "role");

CREATE INDEX "tenant_membership_roles_tenantMembershipId_idx"
  ON "tenant_membership_roles"("tenantMembershipId");

CREATE INDEX "tenant_membership_roles_role_idx"
  ON "tenant_membership_roles"("role");

ALTER TABLE "tenant_membership_roles"
  ADD CONSTRAINT "tenant_membership_roles_tenantMembershipId_fkey"
  FOREIGN KEY ("tenantMembershipId") REFERENCES "tenant_memberships"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tenant_membership_roles"
  ADD CONSTRAINT "tenant_membership_roles_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Legacy → canonical backfill. WAREHOUSE becomes WAREHOUSE_STAFF only.
-- Do not manufacture TRANSPORT_ADMIN / FINANCE_ADMIN / WAREHOUSE_ADMIN / CUSTOMER_ADMIN
-- unless those legacy memberships already exist.
INSERT INTO "tenant_membership_roles" ("id", "tenantMembershipId", "role", "createdAt")
SELECT
  'tmr_' || m.id || '_' || mapped.canonical,
  m.id,
  mapped.canonical::"CanonicalTenantRole",
  CURRENT_TIMESTAMP
FROM "tenant_memberships" m
CROSS JOIN LATERAL (
  SELECT CASE m."role"::text
    WHEN 'ADMIN' THEN 'TENANT_ADMIN'
    WHEN 'TRANSPORT_STAFF' THEN 'TRANSPORT_ADMIN'
    WHEN 'OPS' THEN 'TRANSPORT_ADMIN'
    WHEN 'DRIVER' THEN 'TRANSPORT_DRIVER'
    WHEN 'FINANCE' THEN 'FINANCE_ADMIN'
    WHEN 'WAREHOUSE' THEN 'WAREHOUSE_STAFF'
    WHEN 'CUSTOMER' THEN 'CUSTOMER_ADMIN'
    ELSE NULL
  END AS canonical
) mapped
WHERE mapped.canonical IS NOT NULL
ON CONFLICT ("tenantMembershipId", "role") DO NOTHING;
