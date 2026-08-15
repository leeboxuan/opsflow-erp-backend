import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TenantModule } from "@prisma/client";
import { ModuleEntitlementGuard } from "./module-entitlement.guard";

describe("ModuleEntitlementGuard", () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      tenantModuleEntitlement: { findUnique: jest.fn() },
    };
  });

  function makeCtx(tenantId?: string) {
    const request = {
      tenant: tenantId ? { tenantId } : undefined,
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  }

  it("allows when no module metadata is set", async () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as any;
    const guard = new ModuleEntitlementGuard(prisma, reflector);
    await expect(guard.canActivate(makeCtx("t1"))).resolves.toBe(true);
    expect(prisma.tenantModuleEntitlement.findUnique).not.toHaveBeenCalled();
  });

  it("allows when required module is enabled", async () => {
    const reflector = {
      getAllAndOverride: () => [TenantModule.TRANSPORT],
    } as any;
    prisma.tenantModuleEntitlement.findUnique.mockResolvedValue({
      enabled: true,
    });
    const guard = new ModuleEntitlementGuard(prisma, reflector);
    await expect(guard.canActivate(makeCtx("t1"))).resolves.toBe(true);
  });

  it("blocks disabled module server-side", async () => {
    const reflector = {
      getAllAndOverride: () => [TenantModule.FINANCE],
    } as any;
    prisma.tenantModuleEntitlement.findUnique.mockResolvedValue({
      enabled: false,
    });
    const guard = new ModuleEntitlementGuard(prisma, reflector);
    await expect(guard.canActivate(makeCtx("t1"))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("blocks disabled module even for Platform Admin operating a tenant", async () => {
    const reflector = {
      getAllAndOverride: () => [TenantModule.TRANSPORT],
    } as any;
    prisma.tenantModuleEntitlement.findUnique.mockResolvedValue({
      enabled: false,
    });
    const guard = new ModuleEntitlementGuard(prisma, reflector);
    const request = {
      tenant: {
        tenantId: "t1",
        isPlatformAdmin: true,
        authMode: "PLATFORM_TENANT_OPERATION",
      },
    };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
