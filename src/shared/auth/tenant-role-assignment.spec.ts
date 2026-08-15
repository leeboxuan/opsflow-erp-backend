import { CanonicalTenantRole, Role, TenantModule } from '@prisma/client';
import {
  assertActorCanAssignRoles,
  assertActorCanAdministerTarget,
  assertValidRoleCombination,
  assignableRolesForActor,
  canAssignRole,
  canManageTenantUsers,
  assertModulesEnabledForRoles,
} from './tenant-role-assignment';

describe('tenant role assignment policy', () => {
  it('lets TENANT_ADMIN assign every canonical role', () => {
    const actor = [CanonicalTenantRole.TENANT_ADMIN];
    expect(canManageTenantUsers(actor)).toBe(true);
    expect(assignableRolesForActor(actor)).toEqual(
      expect.arrayContaining([
        CanonicalTenantRole.TENANT_ADMIN,
        CanonicalTenantRole.TRANSPORT_ADMIN,
        CanonicalTenantRole.TRANSPORT_DRIVER,
        CanonicalTenantRole.FINANCE_ADMIN,
        CanonicalTenantRole.WAREHOUSE_ADMIN,
        CanonicalTenantRole.WAREHOUSE_STAFF,
        CanonicalTenantRole.CUSTOMER_ADMIN,
      ]),
    );
  });

  it('lets TRANSPORT_ADMIN assign only TRANSPORT_DRIVER and CUSTOMER_ADMIN', () => {
    const actor = [CanonicalTenantRole.TRANSPORT_ADMIN];
    expect(canAssignRole(actor, CanonicalTenantRole.TRANSPORT_DRIVER)).toBe(true);
    expect(canAssignRole(actor, CanonicalTenantRole.CUSTOMER_ADMIN)).toBe(true);
    expect(canAssignRole(actor, CanonicalTenantRole.TENANT_ADMIN)).toBe(false);
    expect(canAssignRole(actor, CanonicalTenantRole.TRANSPORT_ADMIN)).toBe(false);
    expect(canAssignRole(actor, CanonicalTenantRole.FINANCE_ADMIN)).toBe(false);
    expect(canAssignRole(actor, CanonicalTenantRole.WAREHOUSE_ADMIN)).toBe(false);
    expect(canAssignRole(actor, CanonicalTenantRole.WAREHOUSE_STAFF)).toBe(false);
  });

  it('unions capabilities across multiple actor roles', () => {
    expect(
      assignableRolesForActor([
        CanonicalTenantRole.TRANSPORT_ADMIN,
        CanonicalTenantRole.FINANCE_ADMIN,
      ]),
    ).toEqual([
      CanonicalTenantRole.TRANSPORT_DRIVER,
      CanonicalTenantRole.CUSTOMER_ADMIN,
    ]);
    expect(
      canAssignRole(
        [CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.TRANSPORT_ADMIN],
        CanonicalTenantRole.FINANCE_ADMIN,
      ),
    ).toBe(true);
  });

  it('rejects FINANCE_ADMIN role management', () => {
    expect(canManageTenantUsers([CanonicalTenantRole.FINANCE_ADMIN])).toBe(false);
    expect(() =>
      assertActorCanAssignRoles(
        [CanonicalTenantRole.FINANCE_ADMIN],
        [CanonicalTenantRole.FINANCE_ADMIN],
      ),
    ).toThrow(/cannot manage tenant user roles/i);
  });

  it('rejects CUSTOMER_ADMIN mixed with staff/admin/driver roles', () => {
    expect(() =>
      assertValidRoleCombination([
        CanonicalTenantRole.CUSTOMER_ADMIN,
        CanonicalTenantRole.TENANT_ADMIN,
      ]),
    ).toThrow(/CUSTOMER_ADMIN/);
    expect(() =>
      assertValidRoleCombination([
        CanonicalTenantRole.CUSTOMER_ADMIN,
        CanonicalTenantRole.TRANSPORT_DRIVER,
      ]),
    ).toThrow(/CUSTOMER_ADMIN/);
  });

  it('allows TRANSPORT_DRIVER with office/admin roles for dual-surface access', () => {
    expect(() =>
      assertValidRoleCombination([
        CanonicalTenantRole.TRANSPORT_DRIVER,
        CanonicalTenantRole.TRANSPORT_ADMIN,
      ]),
    ).not.toThrow();
  });

  it('allows WAREHOUSE_ADMIN + WAREHOUSE_STAFF and multi staff admins', () => {
    expect(() =>
      assertValidRoleCombination([
        CanonicalTenantRole.WAREHOUSE_ADMIN,
        CanonicalTenantRole.WAREHOUSE_STAFF,
      ]),
    ).not.toThrow();
    expect(() =>
      assertValidRoleCombination([
        CanonicalTenantRole.TRANSPORT_ADMIN,
        CanonicalTenantRole.FINANCE_ADMIN,
      ]),
    ).not.toThrow();
  });

  it('requires every module-bound role to have its module enabled', async () => {
    const findUnique = jest
      .fn()
      .mockImplementation(async ({ where }: any) => {
        if (where.tenantId_module.module === TenantModule.TRANSPORT) {
          return { enabled: true };
        }
        return { enabled: false };
      });
    await expect(
      assertModulesEnabledForRoles(
        { tenantModuleEntitlement: { findUnique } },
        't1',
        [CanonicalTenantRole.TRANSPORT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN],
      ),
    ).rejects.toThrow(/FINANCE/);
  });

  it('accepts legacy actor aliases when checking assignment', () => {
    expect(canAssignRole([Role.ADMIN], CanonicalTenantRole.WAREHOUSE_ADMIN)).toBe(
      true,
    );
    expect(canAssignRole([Role.TRANSPORT_STAFF], CanonicalTenantRole.TRANSPORT_DRIVER)).toBe(
      true,
    );
  });

  it('lets TRANSPORT_ADMIN administer Drivers and Customer Admins only', () => {
    expect(() =>
      assertActorCanAdministerTarget(
        [CanonicalTenantRole.TRANSPORT_ADMIN],
        [CanonicalTenantRole.CUSTOMER_ADMIN],
      ),
    ).not.toThrow();
    expect(() =>
      assertActorCanAdministerTarget(
        [CanonicalTenantRole.TRANSPORT_ADMIN],
        [CanonicalTenantRole.TRANSPORT_DRIVER],
      ),
    ).not.toThrow();
    expect(() =>
      assertActorCanAdministerTarget(
        [CanonicalTenantRole.TRANSPORT_ADMIN],
        [CanonicalTenantRole.TENANT_ADMIN],
      ),
    ).toThrow(/Transport Admin can only manage/);
    expect(() =>
      assertActorCanAdministerTarget(
        [CanonicalTenantRole.TRANSPORT_ADMIN],
        [CanonicalTenantRole.FINANCE_ADMIN],
      ),
    ).toThrow(/Transport Admin can only manage/);
  });
});
