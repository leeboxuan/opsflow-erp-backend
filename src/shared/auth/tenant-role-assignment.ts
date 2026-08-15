import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CanonicalTenantRole, TenantModule } from '@prisma/client';
import {
  CANONICAL_TENANT_ROLES,
  INTERNAL_STAFF_ROLES,
  hasAnyRole,
  hasRole,
  moduleRequiredForCanonicalRole,
  toCanonicalTenantRole,
  toCanonicalTenantRoles,
  type RoleLike,
} from './canonical-tenant-role';

export const TENANT_ADMIN_ASSIGNABLE_ROLES: readonly CanonicalTenantRole[] =
  CANONICAL_TENANT_ROLES;

export const TRANSPORT_ADMIN_ASSIGNABLE_ROLES: readonly CanonicalTenantRole[] = [
  CanonicalTenantRole.TRANSPORT_DRIVER,
  CanonicalTenantRole.CUSTOMER_ADMIN,
] as const;

const ASSIGNABLE_SET = new Set<string>(CANONICAL_TENANT_ROLES);

export function canManageTenantUsers(actorRoles: readonly RoleLike[]): boolean {
  return (
    hasRole(actorRoles, CanonicalTenantRole.TENANT_ADMIN) ||
    hasRole(actorRoles, CanonicalTenantRole.TRANSPORT_ADMIN)
  );
}

export function assignableRolesForActor(
  actorRoles: readonly RoleLike[],
): CanonicalTenantRole[] {
  const roles = new Set<CanonicalTenantRole>();
  if (hasRole(actorRoles, CanonicalTenantRole.TENANT_ADMIN)) {
    for (const role of TENANT_ADMIN_ASSIGNABLE_ROLES) roles.add(role);
  }
  if (hasRole(actorRoles, CanonicalTenantRole.TRANSPORT_ADMIN)) {
    for (const role of TRANSPORT_ADMIN_ASSIGNABLE_ROLES) roles.add(role);
  }
  return [...roles];
}

export function canAssignRole(
  actorRoles: readonly RoleLike[],
  targetRole: RoleLike,
): boolean {
  const canonical = toCanonicalTenantRole(targetRole);
  if (!canonical) return false;
  return assignableRolesForActor(actorRoles).includes(canonical);
}

export function assertActorCanAssignRoles(
  actorRoles: readonly RoleLike[],
  targetRoles: readonly CanonicalTenantRole[],
): void {
  if (!targetRoles.length) {
    throw new BadRequestException('At least one role is required');
  }
  const assignable = new Set(assignableRolesForActor(actorRoles));
  if (!assignable.size) {
    throw new ForbiddenException('You cannot manage tenant user roles');
  }
  const forbidden = targetRoles.filter((role) => !assignable.has(role));
  if (forbidden.length) {
    throw new ForbiddenException(
      `Cannot assign role(s): ${forbidden.join(', ')}`,
    );
  }
}

/**
 * Combination rules:
 * - CUSTOMER_ADMIN cannot mix with internal staff/admin roles or TRANSPORT_DRIVER.
 * - TRANSPORT_DRIVER may coexist with internal office/admin roles. Access is
 *   surface-specific: Driver Mobile requires TRANSPORT_DRIVER; staff web
 *   requires a non-driver-only role set.
 * - WAREHOUSE_ADMIN + WAREHOUSE_STAFF is allowed.
 */
export function assertValidRoleCombination(
  roles: readonly CanonicalTenantRole[],
): void {
  const unique = toCanonicalTenantRoles(roles);
  if (!unique.length) {
    throw new BadRequestException('At least one role is required');
  }

  const unknown = roles.filter((role) => !ASSIGNABLE_SET.has(String(role)));
  if (unknown.length) {
    throw new BadRequestException(`Unsupported role(s): ${unknown.join(', ')}`);
  }

  const hasCustomer = unique.includes(CanonicalTenantRole.CUSTOMER_ADMIN);
  const hasDriver = unique.includes(CanonicalTenantRole.TRANSPORT_DRIVER);
  const hasInternal = unique.some((role) =>
    INTERNAL_STAFF_ROLES.includes(role),
  );

  if (hasCustomer && (hasInternal || hasDriver)) {
    throw new BadRequestException(
      'CUSTOMER_ADMIN cannot be combined with internal tenant staff/admin roles or TRANSPORT_DRIVER',
    );
  }
}

export type ModuleEntitlementLookup = {
  findUnique: (args: {
    where: { tenantId_module: { tenantId: string; module: TenantModule } };
    select: { enabled: true };
  }) => Promise<{ enabled: boolean } | null>;
};

export async function assertModulesEnabledForRoles(
  prisma: any,
  tenantId: string,
  roles: readonly CanonicalTenantRole[],
): Promise<void> {
  const required = new Map<TenantModule, CanonicalTenantRole[]>();
  for (const role of roles) {
    const module = moduleRequiredForCanonicalRole(role);
    if (!module) continue;
    const list = required.get(module) ?? [];
    list.push(role);
    required.set(module, list);
  }
  if (!required.size) return;

  const lookup = prisma.tenantModuleEntitlement;
  if (!lookup?.findUnique) {
    throw new ForbiddenException(
      'Cannot assign role: tenant module entitlement lookup unavailable',
    );
  }

  for (const [module, moduleRoles] of required) {
    const row = await lookup.findUnique({
      where: { tenantId_module: { tenantId, module } },
      select: { enabled: true },
    });
    if (!row?.enabled) {
      throw new ForbiddenException(
        `Cannot assign role(s) ${moduleRoles.join(', ')}: tenant module ${module} is not enabled`,
      );
    }
  }
}

export function parseCanonicalRoleList(input: unknown): CanonicalTenantRole[] {
  if (!Array.isArray(input)) {
    throw new BadRequestException('roles must be an array');
  }
  const parsed = toCanonicalTenantRoles(input as RoleLike[]);
  if (parsed.length !== input.length) {
    const invalid = (input as unknown[])
      .map((value) => String(value))
      .filter((value) => !toCanonicalTenantRole(value));
    throw new BadRequestException(
      `Unsupported role(s): ${invalid.join(', ') || 'invalid roles'}`,
    );
  }
  return parsed;
}

export function actorRolesFromTenantContext(tenant: {
  roles?: readonly RoleLike[] | null;
  role?: RoleLike;
  isPlatformAdmin?: boolean;
  authMode?: string;
}): CanonicalTenantRole[] {
  if (
    tenant.isPlatformAdmin === true &&
    tenant.authMode === 'PLATFORM_TENANT_OPERATION'
  ) {
    return [CanonicalTenantRole.TENANT_ADMIN];
  }
  const fromArray = toCanonicalTenantRoles(tenant.roles ?? []);
  if (fromArray.length) return fromArray;
  const fallback = toCanonicalTenantRole(tenant.role);
  return fallback ? [fallback] : [];
}

export const TRANSPORT_ADMIN_MANAGEABLE_ROLES: readonly CanonicalTenantRole[] = [
  CanonicalTenantRole.TRANSPORT_DRIVER,
  CanonicalTenantRole.CUSTOMER_ADMIN,
] as const;

export function isTransportAdminManageableRoleSet(
  targetRoles: readonly RoleLike[],
): boolean {
  const canonical = toCanonicalTenantRoles(targetRoles);
  if (!canonical.length) return false;
  return canonical.every((role) =>
    TRANSPORT_ADMIN_MANAGEABLE_ROLES.includes(role),
  );
}

/**
 * Tenant Admin (and Platform Admin operating) may administer any tenant membership.
 * Transport Admin may administer only DRIVER / CUSTOMER_ADMIN memberships.
 */
export function assertActorCanAdministerTarget(
  actorRoles: readonly RoleLike[],
  targetRoles: readonly RoleLike[],
): void {
  if (hasRole(actorRoles, CanonicalTenantRole.TENANT_ADMIN)) {
    return;
  }
  if (hasRole(actorRoles, CanonicalTenantRole.TRANSPORT_ADMIN)) {
    if (!isTransportAdminManageableRoleSet(targetRoles)) {
      throw new ForbiddenException(
        'Transport Admin can only manage Transport Drivers and Customer Admins',
      );
    }
    return;
  }
  throw new ForbiddenException('You cannot manage tenant users');
}

export { hasAnyRole, hasRole };
