import { Role } from '@prisma/client';
import {
  assertWarehouseUserCanAccessJob,
  buildWarehouseUserListWhere,
} from './warehouse-job-access';
import { WarehouseJobStatus } from '@prisma/client';

describe('warehouse-job-access', () => {
  it('WAREHOUSE role exists in Prisma Role enum', () => {
    expect(Object.values(Role)).toContain(Role.WAREHOUSE);
  });

  it('allows assigned WAREHOUSE user', () => {
    expect(() =>
      assertWarehouseUserCanAccessJob(
        {
          id: 'job-1',
          status: WarehouseJobStatus.IN_PROGRESS,
          assignedToUserId: 'user-1',
        },
        'user-1',
      ),
    ).not.toThrow();
  });

  it('allows unassigned OPEN/IN_PROGRESS queue job', () => {
    expect(() =>
      assertWarehouseUserCanAccessJob(
        {
          id: 'job-1',
          status: WarehouseJobStatus.OPEN,
          assignedToUserId: null,
        },
        'user-1',
      ),
    ).not.toThrow();
  });

  it('builds list filter for assigned or open queue', () => {
    expect(buildWarehouseUserListWhere('tenant-1', 'user-1')).toEqual({
      tenantId: 'tenant-1',
      OR: [
        { assignedToUserId: 'user-1' },
        {
          assignedToUserId: null,
          status: { in: [WarehouseJobStatus.OPEN, WarehouseJobStatus.IN_PROGRESS] },
        },
      ],
    });
  });
});
