import { Role } from '@prisma/client';
import {
  isTransportStaffRole,
  roleSatisfiesRequirement,
  toPersistedMembershipRole,
  STORE_TRANSPORT_STAFF_AS_CANONICAL,
} from './role-compat';

describe('role-compat', () => {
  it('treats OPS and TRANSPORT_STAFF as transport staff', () => {
    expect(isTransportStaffRole(Role.OPS)).toBe(true);
    expect(isTransportStaffRole(Role.TRANSPORT_STAFF)).toBe(true);
    expect(isTransportStaffRole('OPS')).toBe(true);
    expect(isTransportStaffRole('TRANSPORT_STAFF')).toBe(true);
    expect(isTransportStaffRole(Role.ADMIN)).toBe(false);
    expect(isTransportStaffRole(Role.WAREHOUSE)).toBe(false);
  });

  it('satisfies TRANSPORT_STAFF requirements with legacy OPS membership', () => {
    expect(
      roleSatisfiesRequirement(Role.OPS, [Role.ADMIN, Role.TRANSPORT_STAFF]),
    ).toBe(true);
    expect(
      roleSatisfiesRequirement(Role.TRANSPORT_STAFF, [
        Role.ADMIN,
        Role.OPS,
      ]),
    ).toBe(true);
    expect(
      roleSatisfiesRequirement(Role.DRIVER, [Role.TRANSPORT_STAFF]),
    ).toBe(false);
  });

  it('persists transport staff as OPS while canonical writes are disabled', () => {
    expect(STORE_TRANSPORT_STAFF_AS_CANONICAL).toBe(false);
    expect(toPersistedMembershipRole(Role.TRANSPORT_STAFF)).toBe(Role.OPS);
    expect(toPersistedMembershipRole(Role.OPS)).toBe(Role.OPS);
    expect(toPersistedMembershipRole(Role.WAREHOUSE)).toBe(Role.WAREHOUSE);
    expect(toPersistedMembershipRole(Role.ADMIN)).toBe(Role.ADMIN);
    expect(toPersistedMembershipRole(Role.FINANCE)).toBe(Role.FINANCE);
    expect(toPersistedMembershipRole(Role.CUSTOMER)).toBe(Role.CUSTOMER);
  });
});
