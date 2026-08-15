import { CanonicalTenantRole, Role } from '@prisma/client';
import {
  hasAnyRole,
  hasRole,
  isCustomerAdminRole,
  isFinanceAdminRole,
  isTenantAdminRole,
  isTransportAdminRole,
  isTransportDriverRole,
  isWarehouseAdminRole,
  isWarehouseStaffRole,
  resolveCanonicalRoles,
  toCanonicalTenantRole,
  toLegacyCompatibilityRole,
} from './canonical-tenant-role';

describe('canonical tenant roles', () => {
  it('maps legacy membership values to canonical roles', () => {
    expect(toCanonicalTenantRole(Role.ADMIN)).toBe(CanonicalTenantRole.TENANT_ADMIN);
    expect(toCanonicalTenantRole(Role.TRANSPORT_STAFF)).toBe(
      CanonicalTenantRole.TRANSPORT_ADMIN,
    );
    expect(toCanonicalTenantRole(Role.OPS)).toBe(CanonicalTenantRole.TRANSPORT_ADMIN);
    expect(toCanonicalTenantRole(Role.DRIVER)).toBe(
      CanonicalTenantRole.TRANSPORT_DRIVER,
    );
    expect(toCanonicalTenantRole(Role.FINANCE)).toBe(
      CanonicalTenantRole.FINANCE_ADMIN,
    );
    expect(toCanonicalTenantRole(Role.WAREHOUSE)).toBe(
      CanonicalTenantRole.WAREHOUSE_STAFF,
    );
    expect(toCanonicalTenantRole(Role.CUSTOMER)).toBe(
      CanonicalTenantRole.CUSTOMER_ADMIN,
    );
  });

  it('prefers TenantMembershipRole rows over legacy role', () => {
    expect(
      resolveCanonicalRoles({
        role: Role.ADMIN,
        membershipRoles: [
          { role: CanonicalTenantRole.TRANSPORT_ADMIN },
          { role: CanonicalTenantRole.FINANCE_ADMIN },
        ],
      }),
    ).toEqual([
      CanonicalTenantRole.TRANSPORT_ADMIN,
      CanonicalTenantRole.FINANCE_ADMIN,
    ]);
  });

  it('falls back to legacy role when no canonical rows exist', () => {
    expect(resolveCanonicalRoles({ role: Role.WAREHOUSE })).toEqual([
      CanonicalTenantRole.WAREHOUSE_STAFF,
    ]);
  });

  it('projects a deterministic singular compatibility role', () => {
    expect(
      toLegacyCompatibilityRole([
        CanonicalTenantRole.FINANCE_ADMIN,
        CanonicalTenantRole.TRANSPORT_ADMIN,
      ]),
    ).toBe(Role.TRANSPORT_STAFF);
    expect(
      toLegacyCompatibilityRole([CanonicalTenantRole.TENANT_ADMIN]),
    ).toBe(Role.ADMIN);
  });

  it('treats aliases as equivalent in hasRole / hasAnyRole', () => {
    expect(hasRole([Role.ADMIN], CanonicalTenantRole.TENANT_ADMIN)).toBe(true);
    expect(
      hasAnyRole([CanonicalTenantRole.TRANSPORT_ADMIN], [Role.ADMIN, Role.TRANSPORT_STAFF]),
    ).toBe(true);
    expect(hasAnyRole([CanonicalTenantRole.TRANSPORT_DRIVER], [Role.TRANSPORT_STAFF])).toBe(
      false,
    );
  });

  it('exposes canonical helper predicates', () => {
    expect(isTenantAdminRole(Role.ADMIN)).toBe(true);
    expect(isTransportAdminRole(Role.OPS)).toBe(true);
    expect(isTransportDriverRole(Role.DRIVER)).toBe(true);
    expect(isFinanceAdminRole(Role.FINANCE)).toBe(true);
    expect(isWarehouseStaffRole(Role.WAREHOUSE)).toBe(true);
    expect(isWarehouseAdminRole(CanonicalTenantRole.WAREHOUSE_ADMIN)).toBe(true);
    expect(isCustomerAdminRole(Role.CUSTOMER)).toBe(true);
  });
});
