import { CanonicalTenantRole, Role } from '@prisma/client';
import {
  hasAnyRole,
  isTransportAdminRole,
  toCanonicalTenantRole,
  toLegacyCompatibilityRole,
  type RoleLike,
} from './canonical-tenant-role';

/**
 * Transport staff tenant role.
 *
 * Historical / compatibility storage value: `Role.OPS`
 * Previous product value: `Role.TRANSPORT_STAFF`
 * Canonical product value: `TRANSPORT_ADMIN`
 *
 * Authorization accepts ADMIN/TRANSPORT_STAFF/OPS and canonical aliases
 * via toCanonicalTenantRole / hasAnyRole.
 */
export const TRANSPORT_STAFF_ROLE = Role.TRANSPORT_STAFF;

/** @deprecated Compatibility storage/alias for TRANSPORT_STAFF / TRANSPORT_ADMIN. */
export const DEPRECATED_OPS_ROLE = Role.OPS;

export const TRANSPORT_STAFF_COMPAT_ROLES: readonly Role[] = [
  Role.TRANSPORT_STAFF,
  Role.OPS,
] as const;

/**
 * New membership writes persist canonical TenantMembershipRole rows.
 * Legacy TenantMembership.role is a compatibility projection only.
 */
export const STORE_TRANSPORT_STAFF_AS_CANONICAL = true;

export function isTransportStaffRole(
  role: Role | string | null | undefined,
): boolean {
  return isTransportAdminRole(role);
}

/**
 * Maps an incoming role (API/DTO) to the legacy TenantMembership.role
 * compatibility value. Canonical rows are written separately.
 */
export function toPersistedMembershipRole(role: Role | string): Role {
  const canonical = toCanonicalTenantRole(role);
  if (!canonical) return role as Role;
  return toLegacyCompatibilityRole([canonical], role) ?? (role as Role);
}

/**
 * True when the membership role satisfies a required role, treating
 * legacy aliases as equivalent (ADMIN≡TENANT_ADMIN, OPS≡TRANSPORT_ADMIN, …).
 *
 * @deprecated Prefer hasAnyRole(userRoles, requiredRoles).
 */
export function roleSatisfiesRequirement(
  userRole: Role | string,
  requiredRoles: readonly Role[],
): boolean {
  return hasAnyRole([userRole], requiredRoles);
}

export function rolesSatisfyRequirement(
  userRoles: readonly RoleLike[],
  requiredRoles: readonly RoleLike[],
): boolean {
  return hasAnyRole(userRoles, requiredRoles);
}

export { CanonicalTenantRole };
