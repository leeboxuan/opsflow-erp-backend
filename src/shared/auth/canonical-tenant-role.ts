import { CanonicalTenantRole, Role, TenantModule } from '@prisma/client';

export { CanonicalTenantRole, Role };

/**
 * Canonical tenant RBAC.
 *
 * TenantMembership = relationship between User and Tenant.
 * TenantMembershipRole[] = authorization roles within that tenant.
 *
 * PLATFORM_ADMIN is not a tenant membership role.
 */

export const CANONICAL_TENANT_ROLES: readonly CanonicalTenantRole[] = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.TRANSPORT_ADMIN,
  CanonicalTenantRole.TRANSPORT_DRIVER,
  CanonicalTenantRole.FINANCE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_STAFF,
  CanonicalTenantRole.CUSTOMER_ADMIN,
] as const;

export const INTERNAL_STAFF_ROLES: readonly CanonicalTenantRole[] = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.TRANSPORT_ADMIN,
  CanonicalTenantRole.FINANCE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_STAFF,
] as const;

export const TRANSPORT_OPS_ROLES: readonly CanonicalTenantRole[] = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.TRANSPORT_ADMIN,
] as const;

export const FINANCE_STAFF_ROLES: readonly CanonicalTenantRole[] = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.FINANCE_ADMIN,
] as const;

export const WAREHOUSE_ADMIN_ROLES: readonly CanonicalTenantRole[] = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.WAREHOUSE_ADMIN,
] as const;

export const WAREHOUSE_FLOOR_ROLES: readonly CanonicalTenantRole[] = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.WAREHOUSE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_STAFF,
] as const;

export const CUSTOMER_DIRECTORY_ROLES: readonly CanonicalTenantRole[] = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.TRANSPORT_ADMIN,
  CanonicalTenantRole.FINANCE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_STAFF,
] as const;

/** Priority for the deprecated singular `role` compatibility field (highest first). */
export const LEGACY_ROLE_PROJECTION_PRIORITY: readonly CanonicalTenantRole[] = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.TRANSPORT_ADMIN,
  CanonicalTenantRole.FINANCE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_STAFF,
  CanonicalTenantRole.TRANSPORT_DRIVER,
  CanonicalTenantRole.CUSTOMER_ADMIN,
] as const;

const CANONICAL_SET = new Set<string>(CANONICAL_TENANT_ROLES);

/** Legacy Role / API aliases → canonical tenant role. */
export const LEGACY_TO_CANONICAL: Readonly<Record<string, CanonicalTenantRole>> = {
  ADMIN: CanonicalTenantRole.TENANT_ADMIN,
  TENANT_ADMIN: CanonicalTenantRole.TENANT_ADMIN,
  TRANSPORT_STAFF: CanonicalTenantRole.TRANSPORT_ADMIN,
  OPS: CanonicalTenantRole.TRANSPORT_ADMIN,
  TRANSPORT_ADMIN: CanonicalTenantRole.TRANSPORT_ADMIN,
  DRIVER: CanonicalTenantRole.TRANSPORT_DRIVER,
  TRANSPORT_DRIVER: CanonicalTenantRole.TRANSPORT_DRIVER,
  FINANCE: CanonicalTenantRole.FINANCE_ADMIN,
  FINANCE_ADMIN: CanonicalTenantRole.FINANCE_ADMIN,
  WAREHOUSE: CanonicalTenantRole.WAREHOUSE_STAFF,
  WAREHOUSE_STAFF: CanonicalTenantRole.WAREHOUSE_STAFF,
  WAREHOUSE_ADMIN: CanonicalTenantRole.WAREHOUSE_ADMIN,
  CUSTOMER: CanonicalTenantRole.CUSTOMER_ADMIN,
  CUSTOMER_ADMIN: CanonicalTenantRole.CUSTOMER_ADMIN,
};

/** Canonical → transitional TenantMembership.role value. Never writes OPS. */
export const CANONICAL_TO_LEGACY_ROLE: Readonly<
  Record<CanonicalTenantRole, Role>
> = {
  TENANT_ADMIN: Role.ADMIN,
  TRANSPORT_ADMIN: Role.TRANSPORT_STAFF,
  TRANSPORT_DRIVER: Role.DRIVER,
  FINANCE_ADMIN: Role.FINANCE,
  WAREHOUSE_ADMIN: Role.WAREHOUSE,
  WAREHOUSE_STAFF: Role.WAREHOUSE,
  CUSTOMER_ADMIN: Role.CUSTOMER,
};

export type RoleLike = CanonicalTenantRole | Role | string | null | undefined;

export function normalizeRoleToken(role: RoleLike): string | null {
  if (role == null) return null;
  const token = String(role).trim().toUpperCase();
  return token.length ? token : null;
}

export function toCanonicalTenantRole(
  role: RoleLike,
): CanonicalTenantRole | null {
  const token = normalizeRoleToken(role);
  if (!token) return null;
  return LEGACY_TO_CANONICAL[token] ?? null;
}

export function isCanonicalTenantRole(
  role: RoleLike,
): role is CanonicalTenantRole {
  const token = normalizeRoleToken(role);
  return !!token && CANONICAL_SET.has(token);
}

export function toCanonicalTenantRoles(
  roles: readonly RoleLike[] | null | undefined,
): CanonicalTenantRole[] {
  if (!roles?.length) return [];
  const seen = new Set<CanonicalTenantRole>();
  const result: CanonicalTenantRole[] = [];
  for (const role of roles) {
    const canonical = toCanonicalTenantRole(role);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      result.push(canonical);
    }
  }
  return result;
}

/**
 * Canonical roles for a membership.
 * Prefer TenantMembershipRole rows; fall back to legacy TenantMembership.role.
 */
export function resolveCanonicalRoles(membership: {
  role?: RoleLike;
  membershipRoles?: Array<{ role?: RoleLike }> | null;
  roles?: readonly RoleLike[] | null;
}): CanonicalTenantRole[] {
  if (Array.isArray(membership.membershipRoles) && membership.membershipRoles.length > 0) {
    return toCanonicalTenantRoles(membership.membershipRoles.map((row) => row.role));
  }
  if (Array.isArray(membership.roles) && membership.roles.length > 0) {
    return toCanonicalTenantRoles(membership.roles);
  }
  const fallback = toCanonicalTenantRole(membership.role);
  return fallback ? [fallback] : [];
}

/**
 * Deterministic singular compatibility role (legacy Role enum).
 * Not authorization truth — authorization must consume roles[].
 */
export function toLegacyCompatibilityRole(
  roles: readonly CanonicalTenantRole[],
  fallbackLegacy?: RoleLike,
): Role | null {
  for (const candidate of LEGACY_ROLE_PROJECTION_PRIORITY) {
    if (roles.includes(candidate)) {
      return CANONICAL_TO_LEGACY_ROLE[candidate];
    }
  }
  const mapped = toCanonicalTenantRole(fallbackLegacy);
  return mapped ? CANONICAL_TO_LEGACY_ROLE[mapped] : null;
}

export function hasRole(
  roles: readonly RoleLike[] | RoleLike,
  required: RoleLike,
): boolean {
  const requiredCanonical = toCanonicalTenantRole(required);
  if (!requiredCanonical) return false;
  const list = Array.isArray(roles) ? roles : [roles];
  return toCanonicalTenantRoles(list).includes(requiredCanonical);
}

export function hasAnyRole(
  roles: readonly RoleLike[] | RoleLike,
  required: readonly RoleLike[],
): boolean {
  if (!required.length) return true;
  const list = Array.isArray(roles) ? roles : [roles];
  const have = new Set(toCanonicalTenantRoles(list));
  return required.some((role) => {
    const canonical = toCanonicalTenantRole(role);
    return canonical != null && have.has(canonical);
  });
}

export function isTenantAdminRole(role: RoleLike): boolean {
  return toCanonicalTenantRole(role) === CanonicalTenantRole.TENANT_ADMIN;
}

export function isTransportAdminRole(role: RoleLike): boolean {
  return toCanonicalTenantRole(role) === CanonicalTenantRole.TRANSPORT_ADMIN;
}

export function isTransportDriverRole(role: RoleLike): boolean {
  return toCanonicalTenantRole(role) === CanonicalTenantRole.TRANSPORT_DRIVER;
}

export function isFinanceAdminRole(role: RoleLike): boolean {
  return toCanonicalTenantRole(role) === CanonicalTenantRole.FINANCE_ADMIN;
}

export function isWarehouseAdminRole(role: RoleLike): boolean {
  return toCanonicalTenantRole(role) === CanonicalTenantRole.WAREHOUSE_ADMIN;
}

export function isWarehouseStaffRole(role: RoleLike): boolean {
  return toCanonicalTenantRole(role) === CanonicalTenantRole.WAREHOUSE_STAFF;
}

export function isCustomerAdminRole(role: RoleLike): boolean {
  return toCanonicalTenantRole(role) === CanonicalTenantRole.CUSTOMER_ADMIN;
}

export function actorHasTenantAdmin(
  roles: readonly RoleLike[] | RoleLike,
): boolean {
  return hasRole(roles, CanonicalTenantRole.TENANT_ADMIN);
}

export function actorHasTransportAdmin(
  roles: readonly RoleLike[] | RoleLike,
): boolean {
  return hasRole(roles, CanonicalTenantRole.TRANSPORT_ADMIN);
}

export function moduleRequiredForCanonicalRole(
  role: CanonicalTenantRole,
): TenantModule | null {
  switch (role) {
    case CanonicalTenantRole.TRANSPORT_ADMIN:
    case CanonicalTenantRole.TRANSPORT_DRIVER:
      return TenantModule.TRANSPORT;
    case CanonicalTenantRole.FINANCE_ADMIN:
      return TenantModule.FINANCE;
    case CanonicalTenantRole.WAREHOUSE_ADMIN:
    case CanonicalTenantRole.WAREHOUSE_STAFF:
      return TenantModule.WAREHOUSING;
    case CanonicalTenantRole.TENANT_ADMIN:
    case CanonicalTenantRole.CUSTOMER_ADMIN:
      return null;
    default:
      return null;
  }
}

export function sortCanonicalRoles(
  roles: readonly CanonicalTenantRole[],
): CanonicalTenantRole[] {
  const order = new Map(
    LEGACY_ROLE_PROJECTION_PRIORITY.map((role, index) => [role, index]),
  );
  return [...roles].sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99),
  );
}
