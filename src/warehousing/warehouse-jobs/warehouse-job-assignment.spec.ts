import { Role } from '@prisma/client';
import {
  WAREHOUSE_JOB_ASSIGNABLE_ROLES,
  WAREHOUSING_USER_ROLES,
} from './warehouse-job-assignment';

describe('warehouse-job-assignment', () => {
  it('defines warehousing user roles as transport staff (compat) and WAREHOUSE', () => {
    expect(WAREHOUSING_USER_ROLES).toEqual([
      Role.TRANSPORT_STAFF,
      Role.OPS,
      Role.WAREHOUSE,
    ]);
  });

  it('allows warehouse job assignment to WAREHOUSE, transport staff, and ADMIN', () => {
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.WAREHOUSE)).toBe(true);
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.TRANSPORT_STAFF)).toBe(true);
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.OPS)).toBe(true);
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.ADMIN)).toBe(true);
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.DRIVER)).toBe(false);
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.CUSTOMER)).toBe(false);
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.FINANCE)).toBe(false);
  });
});
