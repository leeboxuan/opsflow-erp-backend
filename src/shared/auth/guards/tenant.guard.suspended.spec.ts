import {
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { MembershipStatus, Role, TenantStatus } from "@prisma/client";
import { TenantGuard } from "./tenant.guard";
import { clearTenantContextCacheForTests } from "../tenant-context.cache";
import {
  AUTH_MODE,
  REQUEST_CONTEXT_KIND,
  isPlatformTenantOperation,
} from "../request-context";
import { RoleGuard } from "./role.guard";

describe("TenantGuard Phase 3 selected-tenant ops", () => {
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

  function makeCtx(user: any, tenantId?: string, correlationId?: string) {
    const headers: Record<string, string> = {};
    if (tenantId) headers["x-tenant-id"] = tenantId;
    if (correlationId) headers["x-correlation-id"] = correlationId;
    const request = {
      user,
      headers,
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
      "corr-9",
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx._request.tenant.tenantSuspended).toBe(true);
    expect(ctx._request.tenant.isPlatformAdmin).toBe(true);
    expect(ctx._request.tenant.role).toBe(Role.ADMIN);
    expect(ctx._request.tenant.tenantStatus).toBe(TenantStatus.SUSPENDED);
    expect(ctx._request.tenant.authMode).toBe(
      AUTH_MODE.PLATFORM_TENANT_OPERATION,
    );
    expect(isPlatformTenantOperation(ctx._request.requestContext)).toBe(true);
    expect(ctx._request.requestContext.correlationId).toBe("corr-9");
    expect(ctx._request.requestContext.effectiveRole).toBe(Role.ADMIN);
  });

  it("allows Platform Admin on SETUP tenant with status in context", async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: "pa-1",
      status: "ACTIVE",
    });
    prisma.tenant.findFirst.mockResolvedValue({
      id: "t1",
      status: TenantStatus.SETUP,
    });
    prisma.tenantMembership.findFirst.mockResolvedValue(null);

    const ctx = makeCtx(
      { userId: "u-pa", authUserId: "a", email: "pa@x.com", role: "USER" },
      "t1",
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx._request.tenant.tenantStatus).toBe(TenantStatus.SETUP);
    expect(ctx._request.tenant.tenantSuspended).toBe(false);
  });

  it("allows Platform Admin on ACTIVE tenant without membership", async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: "pa-1",
      status: "ACTIVE",
    });
    prisma.tenant.findFirst.mockResolvedValue({
      id: "t1",
      status: TenantStatus.ACTIVE,
    });
    prisma.tenantMembership.findFirst.mockResolvedValue(null);

    const ctx = makeCtx(
      { userId: "u-pa", authUserId: "a", email: "pa@x.com", role: "USER" },
      "t1",
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx._request.tenant.role).toBe(Role.ADMIN);
    expect(ctx._request.requestContext.kind).toBe(
      REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
    );
  });

  it("requires X-Tenant-Id for Platform Admin on tenant-scoped routes", async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: "pa-1",
      status: "ACTIVE",
    });

    await expect(
      guard.canActivate(
        makeCtx({
          userId: "u-pa",
          authUserId: "a",
          email: "pa@x.com",
          role: "USER",
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects unknown tenant for Platform Admin", async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: "pa-1",
      status: "ACTIVE",
    });
    prisma.tenant.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        makeCtx(
          { userId: "u-pa", authUserId: "a", email: "pa@x.com", role: "USER" },
          "missing",
        ),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects ARCHIVED tenant for Platform Admin ops", async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue({
      id: "pa-1",
      status: "ACTIVE",
    });
    prisma.tenant.findFirst.mockResolvedValue({
      id: "t1",
      status: TenantStatus.ARCHIVED,
    });

    await expect(
      guard.canActivate(
        makeCtx(
          { userId: "u-pa", authUserId: "a", email: "pa@x.com", role: "USER" },
          "t1",
        ),
      ),
    ).rejects.toThrow(/archived/i);
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

  it("denies ordinary ADMIN Platform Admin override without PlatformAdmin row", async () => {
    prisma.platformAdmin.findUnique.mockResolvedValue(null);
    prisma.tenantMembership.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        makeCtx(
          {
            userId: "u1",
            authUserId: "a1",
            email: "admin@t.com",
            role: "USER",
            isPlatformAdmin: true, // client-forged — ignored without DB row
          },
          "t1",
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
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

  it("ordinary user cannot access tenant without membership via header", async () => {
    prisma.tenantMembership.findFirst.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        makeCtx(
          { userId: "u1", authUserId: "a1", email: "u@t.com", role: "USER" },
          "other-tenant",
        ),
      ),
    ).rejects.toThrow(/not a member/i);
  });
});

describe("RoleGuard Phase 3 platform ADMIN-class", () => {
  const roleGuard = new RoleGuard(new Reflector());

  function makeRoleCtx(opts: {
    required: Role[];
    tenant: any;
    requestContext?: any;
  }) {
    const request = {
      tenant: opts.tenant,
      requestContext: opts.requestContext,
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
      // Reflector override via metadata simulation:
      _required: opts.required,
    } as any;
  }

  it("grants ADMIN-class for platform tenant operation without membership role", () => {
    const reflector = {
      getAllAndOverride: () => [Role.ADMIN, Role.TRANSPORT_STAFF],
    } as any;
    const guard = new RoleGuard(reflector);
    const ok = guard.canActivate(
      makeRoleCtx({
        required: [Role.ADMIN, Role.TRANSPORT_STAFF],
        tenant: {
          tenantId: "t1",
          role: Role.ADMIN,
          isPlatformAdmin: true,
          authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
        },
        requestContext: {
          kind: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
          actorType: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
          isPlatformAdmin: true,
          authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
          tenantId: "t1",
          effectiveRole: Role.ADMIN,
        },
      }),
    );
    expect(ok).toBe(true);
  });

  it("ordinary TRANSPORT_STAFF still cannot satisfy ADMIN-only", () => {
    const reflector = {
      getAllAndOverride: () => [Role.ADMIN],
    } as any;
    const guard = new RoleGuard(reflector);
    expect(() =>
      guard.canActivate(
        makeRoleCtx({
          required: [Role.ADMIN],
          tenant: {
            tenantId: "t1",
            role: Role.TRANSPORT_STAFF,
            isPlatformAdmin: false,
            authMode: AUTH_MODE.MEMBERSHIP,
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("platform ops does not satisfy DRIVER-only routes", () => {
    const reflector = {
      getAllAndOverride: () => [Role.DRIVER],
    } as any;
    const guard = new RoleGuard(reflector);
    expect(() =>
      guard.canActivate(
        makeRoleCtx({
          required: [Role.DRIVER],
          tenant: {
            tenantId: "t1",
            role: Role.ADMIN,
            isPlatformAdmin: true,
            authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
          },
          requestContext: {
            kind: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
            actorType: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
            isPlatformAdmin: true,
            authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
            tenantId: "t1",
            effectiveRole: Role.ADMIN,
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
