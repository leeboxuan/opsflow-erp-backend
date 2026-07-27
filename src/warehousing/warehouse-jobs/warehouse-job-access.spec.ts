import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  assertJobAllowsFloorMutation,
  assertWarehouseUserCanAccessJob,
  buildWarehouseUserListWhere,
} from './warehouse-job-access';
import { WarehouseJobStatus } from '@prisma/client';

describe('warehouse-job-access', () => {
  it('WAREHOUSE role exists in Prisma Role enum', () => {
    expect(Object.values(Role)).toContain(Role.WAREHOUSE);
  });

  it('allows any WAREHOUSE user with user context regardless of assignee', () => {
    expect(() =>
      assertWarehouseUserCanAccessJob(
        {
          id: 'job-1',
          status: WarehouseJobStatus.IN_PROGRESS,
          assignedToUserId: 'other-user',
        },
        'user-1',
      ),
    ).not.toThrow();
  });

  it('allows WAREHOUSE user on terminal COMPLETED job', () => {
    expect(() =>
      assertWarehouseUserCanAccessJob(
        {
          id: 'job-1',
          status: WarehouseJobStatus.COMPLETED,
          assignedToUserId: 'other-user',
        },
        'user-1',
      ),
    ).not.toThrow();
  });

  it('requires user context for WAREHOUSE access', () => {
    expect(() =>
      assertWarehouseUserCanAccessJob(
        {
          id: 'job-1',
          status: WarehouseJobStatus.OPEN,
          assignedToUserId: null,
        },
        undefined,
      ),
    ).toThrow(ForbiddenException);
  });

  it('builds tenant-wide list filter for WAREHOUSE users', () => {
    expect(buildWarehouseUserListWhere('tenant-1', 'user-1')).toEqual({
      tenantId: 'tenant-1',
    });
  });

  it('blocks floor mutation on terminal statuses', () => {
    expect(() =>
      assertJobAllowsFloorMutation(WarehouseJobStatus.COMPLETED),
    ).toThrow('Cannot modify warehouse job when status is COMPLETED');
    expect(() =>
      assertJobAllowsFloorMutation(WarehouseJobStatus.CANCELLED),
    ).toThrow('Cannot modify warehouse job when status is CANCELLED');
    expect(() =>
      assertJobAllowsFloorMutation(WarehouseJobStatus.IN_PROGRESS),
    ).not.toThrow();
  });
});
