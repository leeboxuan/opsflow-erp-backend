import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { parseTenantRoleFilter } from './admin-users.util';

describe('parseTenantRoleFilter', () => {
  it('parses comma-separated roles', () => {
    expect(parseTenantRoleFilter(undefined, 'OPS,WAREHOUSE')).toEqual([
      Role.OPS,
      Role.WAREHOUSE,
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
