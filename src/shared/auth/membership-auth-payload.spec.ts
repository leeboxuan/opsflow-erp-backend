import { Role } from '@prisma/client';
import { toMembershipAuthDto, toTenantModulesDto } from './membership-auth-payload';

describe('membership-auth-payload modules', () => {
  it('maps moduleEntitlements onto tenant.modules', () => {
    const dto = toMembershipAuthDto({
      tenantId: 't1',
      role: Role.ADMIN,
      status: 'Active',
      membershipRoles: [{ role: 'TENANT_ADMIN' }],
      tenant: {
        id: 't1',
        name: 'Acme',
        status: 'ACTIVE',
        timezone: 'Asia/Singapore',
        moduleEntitlements: [
          { module: 'TRANSPORT', enabled: true },
          { module: 'FINANCE', enabled: false },
        ],
      },
    });
    expect(dto.tenant.modules).toEqual([
      { module: 'TRANSPORT', enabled: true },
      { module: 'FINANCE', enabled: false },
    ]);
  });

  it('returns an empty known list when entitlements are missing', () => {
    expect(toTenantModulesDto({})).toEqual([]);
    expect(toTenantModulesDto({ moduleEntitlements: [] })).toEqual([]);
  });
});
