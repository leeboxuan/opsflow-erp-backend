import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { MembershipStatus, Role, TenantStatus } from "@prisma/client";
import { TenantGuard } from "./tenant.guard";
import { clearTenantContextCacheForTests } from "../tenant-context.cache";

describe("TenantGuard suspended tenant", () => {
  let guard: TenantGuard;
  let prisma: any;

  beforeEach(() => {
    clearTenantContextCacheForTests();
    prisma = {
      platformAdmin: { findUnique: jest.fn().mockResolvedValue(null) },
      tenant: { findFirst: jest.fn() },
      tenantMembership: { findFirst: jest.fn() },
      user: { findUnique: jest.fn() },
      customer_companies: { findFirst: jest.fn() },
    };
    guard = new TenantGuard(prisma, new Reflector());
  });

  function makeCtx(user: any, tenantId?: string) {
    const request = {
      user,
      headers: tenantId ? { "x-tenant-id": tenantId } : {},
      tenant: undefined as any,
      requestContext: undefined as any,
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
      _request: request,
    } as any;
  }

  it("blocks ordinary users on SUSPENDED tenant", async () => {
    prisma.tenantMembership.findFirst.mockResolvedValue({
      role: Role.ADMIN,
      status: MembershipStatus.Active,
      tenant: { id: "t1", status: TenantStatus.SUSPENDED },
    });

    await expect(
      guard.canActivate(
        makeCtx(
          { userId: "u1", authUserId: "a1", email: "u@t.com", role: "USER" },
          "t1",
        ),
      ),
    ).rejects.toThrow(/suspended/i);
  });

  it("allows Platform Admin on SUSPENDED tenant with tenantSuspended flag", async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: "pa-1",
      status: "ACTIVE",
    });
    prisma.tenant.findFirst.mockResolvedValue({
      id: "t1",
      status: TenantStatus.SUSPENDED,
    });
    prisma.tenantMembership.findFirst.mockResolvedValue(null);

    const ctx = makeCtx(
      {
        userId: "u-pa",
        authUserId: "a-pa",
        email: "pa@opsflow.io",
        role: "USER",
      },
      "t1",
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx._request.tenant.tenantSuspended).toBe(true);
    expect(ctx._request.tenant.isPlatformAdmin).toBe(true);
  });

  it("allows ordinary users on ACTIVE tenant", async () => {
    prisma.tenantMembership.findFirst.mockResolvedValue({
      role: Role.ADMIN,
      status: MembershipStatus.Active,
      tenant: { id: "t1", status: TenantStatus.ACTIVE },
    });

    await expect(
      guard.canActivate(
        makeCtx(
          { userId: "u1", authUserId: "a1", email: "u@t.com", role: "USER" },
          "t1",
        ),
      ),
    ).resolves.toBe(true);
  });

  it("denies DISABLED platform admin falling back to ordinary path", async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: "pa-x",
      status: "DISABLED",
    });
    prisma.tenantMembership.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        makeCtx(
          {
            userId: "u1",
            authUserId: "a1",
            email: "u@t.com",
            role: "SUPERADMIN",
            isSuperadmin: true,
          },
          "t1",
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
