import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { CanonicalTenantRole, Role, TenantModule } from "@prisma/client";
import {
  moduleRequiredForCanonicalRole,
  toCanonicalTenantRole,
} from "./canonical-tenant-role";
import { assertModulesEnabledForRoles } from "./tenant-role-assignment";

/**
 * Map membership roles to the tenant module required to assign them.
 *
 * CUSTOMER / CUSTOMER_ADMIN: portal role — not bound to a tenant module.
 * ADMIN / TENANT_ADMIN: tenant administration — not module-bound.
 * DRIVER / TRANSPORT_DRIVER: provisioned via /admin/drivers (TRANSPORT).
 */
export function moduleRequiredForRole(
  role: Role | CanonicalTenantRole | string,
): TenantModule | null {
  const canonical = toCanonicalTenantRole(role);
  if (!canonical) return null;
  return moduleRequiredForCanonicalRole(canonical);
}

export type ModuleEntitlementLookup = {
  findUnique: (args: {
    where: { tenantId_module: { tenantId: string; module: TenantModule } };
    select: { enabled: true };
  }) => Promise<{ enabled: boolean } | null>;
};

/**
 * Reject role create/assign when the required module is disabled for the tenant.
 */
export async function assertRoleAllowedByModuleEntitlement(
  prisma: any,
  tenantId: string,
  role: Role | CanonicalTenantRole | string,
): Promise<void> {
  const canonical = toCanonicalTenantRole(role);
  if (!canonical) {
    throw new BadRequestException(`Unsupported role: ${String(role)}`);
  }
  await assertModulesEnabledForRoles(prisma, tenantId, [canonical]);
}

export function assertSupportedCreateRole(role: Role | string): void {
  const canonical = toCanonicalTenantRole(role);
  if (canonical === CanonicalTenantRole.TRANSPORT_DRIVER) {
    throw new BadRequestException("Use /admin/drivers to create drivers");
  }
  if (String(role).toUpperCase() === Role.OPS) {
    throw new BadRequestException(
      "Cannot create OPS memberships; use TRANSPORT_ADMIN",
    );
  }
}
