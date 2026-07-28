import { Role } from '@prisma/client';

/** Warehouse floor PIC — `assignedToUserId`. */
export const WAREHOUSE_JOB_WAREHOUSE_IN_CHARGE_ROLES: ReadonlySet<Role> =
  new Set([Role.WAREHOUSE, Role.ADMIN]);

/** CS / transport office PIC — `csInChargeUserId`. */
export const WAREHOUSE_JOB_CS_IN_CHARGE_ROLES: ReadonlySet<Role> = new Set([
  Role.TRANSPORT_STAFF,
  Role.OPS,
  Role.ADMIN,
]);

/**
 * @deprecated Prefer role-specific sets. Kept for callers that still mean
 * “any warehousing-related assignee”.
 */
export const WAREHOUSE_JOB_ASSIGNABLE_ROLES: ReadonlySet<Role> = new Set([
  ...WAREHOUSE_JOB_WAREHOUSE_IN_CHARGE_ROLES,
  ...WAREHOUSE_JOB_CS_IN_CHARGE_ROLES,
]);

/** Transport staff (web) + warehouse mobile roles for warehousing user management. */
export const WAREHOUSING_USER_ROLES: readonly Role[] = [
  Role.TRANSPORT_STAFF,
  Role.OPS,
  Role.WAREHOUSE,
];

export const WAREHOUSE_IN_CHARGE_VALIDATION_MESSAGE =
  'Warehouse in charge must be a warehouse or admin user.';

export const CS_IN_CHARGE_VALIDATION_MESSAGE =
  'CS in charge must be a transport staff or admin user.';

/** @deprecated Use WAREHOUSE_IN_CHARGE_VALIDATION_MESSAGE */
export const WAREHOUSE_ASSIGNMENT_VALIDATION_MESSAGE =
  WAREHOUSE_IN_CHARGE_VALIDATION_MESSAGE;
