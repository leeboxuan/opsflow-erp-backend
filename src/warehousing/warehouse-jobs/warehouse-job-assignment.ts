import { Role } from '@prisma/client';

/** Roles that may be assigned to warehouse jobs (includes deprecated OPS). */
export const WAREHOUSE_JOB_ASSIGNABLE_ROLES: ReadonlySet<Role> = new Set([
  Role.WAREHOUSE,
  Role.TRANSPORT_STAFF,
  Role.OPS,
  Role.ADMIN,
]);

/** Transport staff (web) + warehouse mobile roles for warehousing user management. */
export const WAREHOUSING_USER_ROLES: readonly Role[] = [
  Role.TRANSPORT_STAFF,
  Role.OPS,
  Role.WAREHOUSE,
];

export const WAREHOUSE_ASSIGNMENT_VALIDATION_MESSAGE =
  'Assigned user must be a warehouse, transport staff, or admin user.';
