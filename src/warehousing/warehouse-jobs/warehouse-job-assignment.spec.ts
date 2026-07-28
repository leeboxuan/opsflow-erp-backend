import { Role } from '@prisma/client';
import {
  WAREHOUSE_JOB_ASSIGNABLE_ROLES,
  WAREHOUSE_JOB_CS_IN_CHARGE_ROLES,
  WAREHOUSE_JOB_WAREHOUSE_IN_CHARGE_ROLES,
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

  it('limits warehouse in charge to WAREHOUSE and ADMIN', () => {
    expect(WAREHOUSE_JOB_WAREHOUSE_IN_CHARGE_ROLES.has(Role.WAREHOUSE)).toBe(
      true,
    );
    expect(WAREHOUSE_JOB_WAREHOUSE_IN_CHARGE_ROLES.has(Role.ADMIN)).toBe(true);
    expect(
      WAREHOUSE_JOB_WAREHOUSE_IN_CHARGE_ROLES.has(Role.TRANSPORT_STAFF),
    ).toBe(false);
    expect(WAREHOUSE_JOB_WAREHOUSE_IN_CHARGE_ROLES.has(Role.OPS)).toBe(false);
  });

  it('limits CS in charge to transport staff and ADMIN', () => {
    expect(WAREHOUSE_JOB_CS_IN_CHARGE_ROLES.has(Role.TRANSPORT_STAFF)).toBe(
      true,
    );
    expect(WAREHOUSE_JOB_CS_IN_CHARGE_ROLES.has(Role.OPS)).toBe(true);
    expect(WAREHOUSE_JOB_CS_IN_CHARGE_ROLES.has(Role.ADMIN)).toBe(true);
    expect(WAREHOUSE_JOB_CS_IN_CHARGE_ROLES.has(Role.WAREHOUSE)).toBe(false);
  });

  it('union assignable roles still covers both PIC types', () => {
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.WAREHOUSE)).toBe(true);
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.TRANSPORT_STAFF)).toBe(true);
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.OPS)).toBe(true);
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.ADMIN)).toBe(true);
    expect(WAREHOUSE_JOB_ASSIGNABLE_ROLES.has(Role.DRIVER)).toBe(false);
  });
});
