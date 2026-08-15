import { CanonicalTenantRole } from '@prisma/client';
import {
  INTERNAL_STAFF_ROLES,
  hasAnyRole,
  hasRole,
  toCanonicalTenantRoles,
  type RoleLike,
} from './canonical-tenant-role';

export const DRIVER_MOBILE_CLIENT_APPS = new Set([
  'mobile',
  'driver_mobile',
]);

export const STAFF_WEB_CLIENT_APPS = new Set(['web', 'staff']);

/** True when the only canonical role is TRANSPORT_DRIVER (legacy DRIVER). */
export function isTransportDriverOnly(
  roles: readonly RoleLike[] | RoleLike | null | undefined,
): boolean {
  const canonical = toCanonicalTenantRoles(
    Array.isArray(roles) ? roles : roles != null ? [roles] : [],
  );
  return (
    canonical.length > 0 &&
    canonical.every((role) => role === CanonicalTenantRole.TRANSPORT_DRIVER)
  );
}

/** Driver Mobile requires an explicit TRANSPORT_DRIVER assignment. */
export function canAccessDriverMobile(
  roles: readonly RoleLike[] | RoleLike | null | undefined,
): boolean {
  return hasRole(
    Array.isArray(roles) ? roles : roles != null ? [roles] : [],
    CanonicalTenantRole.TRANSPORT_DRIVER,
  );
}

/**
 * Staff web is denied for TRANSPORT_DRIVER-only accounts.
 * Office/admin roles (including mixed with TRANSPORT_DRIVER) are allowed.
 * CUSTOMER_ADMIN remains a portal identity, not a Driver-app check.
 */
export function canAccessStaffWeb(
  roles: readonly RoleLike[] | RoleLike | null | undefined,
): boolean {
  return !isTransportDriverOnly(roles);
}

/** CUSTOMER_ADMIN with no internal office/admin role. Mixed customer+staff is rejected at assignment. */
export function isCustomerAdminOnly(
  roles: readonly RoleLike[] | RoleLike | null | undefined,
): boolean {
  const canonical = toCanonicalTenantRoles(
    Array.isArray(roles) ? roles : roles != null ? [roles] : [],
  );
  return (
    canonical.length > 0 &&
    canonical.every((role) => role === CanonicalTenantRole.CUSTOMER_ADMIN)
  );
}

export function hasInternalStaffRole(
  roles: readonly RoleLike[] | RoleLike | null | undefined,
): boolean {
  return hasAnyRole(
    Array.isArray(roles) ? roles : roles != null ? [roles] : [],
    INTERNAL_STAFF_ROLES,
  );
}

export function isDriverMobileClientApp(clientApp: string | null | undefined): boolean {
  return DRIVER_MOBILE_CLIENT_APPS.has(String(clientApp ?? '').trim().toLowerCase());
}

export function isStaffWebClientApp(clientApp: string | null | undefined): boolean {
  const token = String(clientApp ?? '').trim().toLowerCase();
  return token === '' || STAFF_WEB_CLIENT_APPS.has(token);
}
