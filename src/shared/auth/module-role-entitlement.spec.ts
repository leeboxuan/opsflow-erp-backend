import { Role, TenantModule } from "@prisma/client";
import {
  assertRoleAllowedByModuleEntitlement,
  moduleRequiredForRole,
} from "./module-role-entitlement";

describe("moduleRequiredForRole", () => {
  it("maps operational roles to modules", () => {
    expect(moduleRequiredForRole(Role.TRANSPORT_STAFF)).toBe(
      TenantModule.TRANSPORT,
    );
    expect(moduleRequiredForRole(Role.OPS)).toBe(TenantModule.TRANSPORT);
    expect(moduleRequiredForRole(Role.WAREHOUSE)).toBe(
      TenantModule.WAREHOUSING,
    );
    expect(moduleRequiredForRole(Role.FINANCE)).toBe(TenantModule.FINANCE);
    expect(moduleRequiredForRole(Role.ADMIN)).toBeNull();
    expect(moduleRequiredForRole(Role.CUSTOMER)).toBeNull();
  });
});

describe("assertRoleAllowedByModuleEntitlement", () => {
  it("allows ADMIN without module lookup", async () => {
    const prisma = {
      tenantModuleEntitlement: { findUnique: jest.fn() },
    };
    await assertRoleAllowedByModuleEntitlement(
      prisma as any,
      "t1",
      Role.ADMIN,
    );
    expect(prisma.tenantModuleEntitlement.findUnique).not.toHaveBeenCalled();
  });

  it("rejects TRANSPORT_STAFF when TRANSPORT disabled", async () => {
    const prisma = {
      tenantModuleEntitlement: {
        findUnique: jest.fn().mockResolvedValue({ enabled: false }),
      },
    };
    await expect(
      assertRoleAllowedByModuleEntitlement(
        prisma as any,
        "t1",
        Role.TRANSPORT_STAFF,
      ),
    ).rejects.toThrow(/TRANSPORT/);
  });

  it("allows FINANCE when FINANCE enabled", async () => {
    const prisma = {
      tenantModuleEntitlement: {
        findUnique: jest.fn().mockResolvedValue({ enabled: true }),
      },
    };
    await assertRoleAllowedByModuleEntitlement(
      prisma as any,
      "t1",
      Role.FINANCE,
    );
  });
});
