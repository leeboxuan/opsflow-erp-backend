import { MembershipStatus, Role } from '@prisma/client';
import {
  isUsernamePasswordOperationalUser,
  mapTenantMembershipToPublicUserDto,
} from './admin-users.mapper';
import { AUTH_INTERNAL_EMAIL_DOMAIN } from '../shared/auth/auth-internal-email';

describe('admin-users.mapper', () => {
  it('redacts internal auth emails from public DTOs', () => {
    const dto = mapTenantMembershipToPublicUserDto({
      id: 'm1',
      role: Role.WAREHOUSE,
      status: MembershipStatus.Active,
      user: {
        id: 'u1',
        email: `acme.floor1@${AUTH_INTERNAL_EMAIL_DOMAIN}`,
        username: 'floor1',
        name: 'Floor',
        phone: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    });
    expect(dto.email).toBeNull();
    expect(dto.username).toBe('floor1');
    expect(dto.roles).toEqual(['WAREHOUSE_STAFF']);
    expect(JSON.stringify(dto)).not.toContain(AUTH_INTERNAL_EMAIL_DOMAIN);
  });

  it('keeps real office emails', () => {
    const dto = mapTenantMembershipToPublicUserDto({
      id: 'm2',
      role: Role.TRANSPORT_STAFF,
      status: MembershipStatus.Active,
      user: {
        id: 'u2',
        email: 'ops@example.com',
        username: null,
        name: 'Ops',
        phone: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    });
    expect(dto.email).toBe('ops@example.com');
    expect(dto.roles).toEqual(['TRANSPORT_ADMIN']);
  });

  it('exposes multiple canonical roles when membership rows exist', () => {
    const dto = mapTenantMembershipToPublicUserDto({
      id: 'm3',
      role: Role.TRANSPORT_STAFF,
      status: MembershipStatus.Active,
      membershipRoles: [
        { role: 'TRANSPORT_ADMIN' },
        { role: 'FINANCE_ADMIN' },
      ],
      user: {
        id: 'u3',
        email: 'cs@example.com',
        username: null,
        name: 'CS',
        phone: null,
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-01'),
      },
    });
    expect(dto.roles).toEqual(['TRANSPORT_ADMIN', 'FINANCE_ADMIN']);
    expect(dto.role).toBe(Role.TRANSPORT_STAFF);
  });

  it('identifies username/password operational users', () => {
    expect(
      isUsernamePasswordOperationalUser({ role: Role.WAREHOUSE }),
    ).toBe(true);
    expect(
      isUsernamePasswordOperationalUser({
        role: Role.TRANSPORT_STAFF,
        username: null,
        email: 'ops@example.com',
      }),
    ).toBe(false);
    expect(
      isUsernamePasswordOperationalUser({
        role: Role.ADMIN,
        username: 'legacy',
      }),
    ).toBe(true);
  });
});
