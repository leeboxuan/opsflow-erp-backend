import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Role, TenantModule } from "@prisma/client";

/**
 * Map membership roles to the tenant module required to assign them.
 *
 * CUSTOMER: portal role — not bound to TRANSPORT/WAREHOUSING/FINANCE.
 * ADMIN: tenant administration — not module-bound (still needs TenantGuard).
 * DRIVER: provisioned via /admin/drivers (TRANSPORT domain) — not this helper.
 */
export function moduleRequiredForRole(role: Role): TenantModule | null {
  switch (role) {
    case Role.TRANSPORT_STAFF:
    case Role.OPS:
      return TenantModule.TRANSPORT;
    case Role.WAREHOUSE:
      return TenantModule.WAREHOUSING;
    case Role.FINANCE:
      return TenantModule.FINANCE;
    case Role.ADMIN:
    case Role.CUSTOMER:
      return null;
    case Role.DRIVER:
      return TenantModule.TRANSPORT;
    default:
      return null;
  }
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
  // PrismaService (or test doubles) — typed loosely for client version skew.
  prisma: any,
  tenantId: string,
  role: Role,
): Promise<void> {
  const module = moduleRequiredForRole(role);
  if (!module) return;

  const lookup = prisma?.tenantModuleEntitlement as ModuleEntitlementLookup | undefined;
  if (!lookup?.findUnique) {
    throw new ForbiddenException(
      `Cannot assign role ${role}: tenant module entitlement lookup unavailable`,
    );
  }

  const row = await lookup.findUnique({
    where: { tenantId_module: { tenantId, module } },
    select: { enabled: true },
  });
  if (!row?.enabled) {
    throw new ForbiddenException(
      `Cannot assign role ${role}: tenant module ${module} is not enabled`,
    );
  }
}

export function assertSupportedCreateRole(role: Role): void {
  if (role === Role.DRIVER) {
    throw new BadRequestException("Use /admin/drivers to create drivers");
  }
  if (role === Role.OPS) {
    throw new BadRequestException(
      "Cannot create OPS memberships; use TRANSPORT_STAFF",
    );
  }
}
