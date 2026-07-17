import { Role } from '@prisma/client';

/** Roles that may be assigned to warehouse jobs. */
export const WAREHOUSE_JOB_ASSIGNABLE_ROLES: ReadonlySet<Role> = new Set([
  Role.WAREHOUSE,
  Role.OPS,
  Role.ADMIN,
]);

/** OPS web + warehouse mobile user roles for warehousing user management. */
export const WAREHOUSING_USER_ROLES: readonly Role[] = [Role.OPS, Role.WAREHOUSE];

export const WAREHOUSE_ASSIGNMENT_VALIDATION_MESSAGE =
  'Assigned user must be a warehouse, ops, or admin user.';
