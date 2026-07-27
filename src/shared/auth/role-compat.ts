import { Role } from '@prisma/client';

/**
 * Transport staff tenant role.
 *
 * Historical / compatibility storage value: `Role.OPS`
 * Canonical product value: `Role.TRANSPORT_STAFF`
 *
 * During the compatibility window:
 * - Authorization accepts both OPS and TRANSPORT_STAFF (see roleSatisfiesRequirement).
 * - New membership writes still persist OPS until every deployed client understands
 *   TRANSPORT_STAFF (see toPersistedMembershipRole / STORE_TRANSPORT_STAFF_AS_CANONICAL).
 * - Do not drop OPS from the PostgreSQL enum until membership rows are migrated.
 */
export const TRANSPORT_STAFF_ROLE = Role.TRANSPORT_STAFF;

/** @deprecated Compatibility storage/alias for TRANSPORT_STAFF. */
export const DEPRECATED_OPS_ROLE = Role.OPS;

export const TRANSPORT_STAFF_COMPAT_ROLES: readonly Role[] = [
  Role.TRANSPORT_STAFF,
  Role.OPS,
] as const;

/**
 * Flip to `true` only after:
 * 1. Additive migration `TRANSPORT_STAFF` is applied to every environment DB
 * 2. Web, warehouse-mobile, and driver-mobile builds that accept TRANSPORT_STAFF
 *    are deployed to all active clients
 * 3. A data migration plan exists to UPDATE remaining OPS rows → TRANSPORT_STAFF
 *
 * Until then, transport-staff memberships must continue to be stored as OPS.
 */
export const STORE_TRANSPORT_STAFF_AS_CANONICAL = true;

export function isTransportStaffRole(
  role: Role | string | null | undefined,
): boolean {
  if (role == null) return false;
  const normalized = String(role).toUpperCase();
  return (
    normalized === Role.TRANSPORT_STAFF ||
    normalized === Role.OPS ||
    normalized === 'TRANSPORT_STAFF' ||
    normalized === 'OPS'
  );
}

/**
 * Maps an incoming role (API/DTO) to the value that should be written to
 * `tenant_memberships.role` during the compatibility window.
 *
 * - Transport staff intent (OPS or TRANSPORT_STAFF) → OPS while
 *   STORE_TRANSPORT_STAFF_AS_CANONICAL is false
 * - WAREHOUSE / ADMIN / FINANCE / CUSTOMER / DRIVER → unchanged
 */
export function toPersistedMembershipRole(role: Role): Role {
  if (!isTransportStaffRole(role)) {
    return role;
  }
  return STORE_TRANSPORT_STAFF_AS_CANONICAL
    ? Role.TRANSPORT_STAFF
    : Role.OPS;
}

/**
 * True when the membership role satisfies a required role, treating
 * OPS and TRANSPORT_STAFF as equivalent during the compatibility window.
 */
export function roleSatisfiesRequirement(
  userRole: Role | string,
  requiredRoles: readonly Role[],
): boolean {
  if (!requiredRoles.length) return true;
  if (requiredRoles.includes(userRole as Role)) return true;

  if (
    isTransportStaffRole(userRole) &&
    requiredRoles.some((r) => isTransportStaffRole(r))
  ) {
    return true;
  }

  return false;
}
