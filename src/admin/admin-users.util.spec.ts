import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { parseTenantRoleFilter } from './admin-users.util';

describe('parseTenantRoleFilter', () => {
  it('parses comma-separated roles and expands OPS to include TRANSPORT_STAFF', () => {
    expect(parseTenantRoleFilter(undefined, 'OPS,WAREHOUSE')).toEqual([
      Role.WAREHOUSE,
      Role.TRANSPORT_STAFF,
      Role.OPS,
    ]);
  });

  it('expands TRANSPORT_STAFF filter to include legacy OPS', () => {
    expect(parseTenantRoleFilter(Role.TRANSPORT_STAFF)).toEqual([
      Role.TRANSPORT_STAFF,
      Role.OPS,
    ]);
  });

  it('prefers single role param', () => {
    expect(parseTenantRoleFilter(Role.WAREHOUSE, 'OPS,ADMIN')).toEqual([
      Role.WAREHOUSE,
    ]);
  });

  it('rejects invalid role values', () => {
    expect(() => parseTenantRoleFilter(undefined, 'OPS,NOT_A_ROLE')).toThrow(
      BadRequestException,
    );
  });
});
