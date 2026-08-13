import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { PlatformAdminStatus } from "@prisma/client";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { REQUEST_CONTEXT_KIND } from "../request-context";

describe("PlatformAdminGuard (Phase 1)", () => {
  function makeGuard(prisma: {
    platformAdmin: { findUnique: jest.Mock };
  }) {
    return new PlatformAdminGuard(prisma as any);
  }

  function makeContext(user: Record<string, unknown> | null): ExecutionContext {
    const request: Record<string, unknown> = {
      user,
      headers: {},
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;
  }

  it("allows ACTIVE PlatformAdmin and attaches PLATFORM_ADMIN context", async () => {
    const prisma = {
      platformAdmin: {
        findUnique: jest.fn().mockResolvedValue({
          id: "pa-1",
          status: PlatformAdminStatus.ACTIVE,
        }),
      },
    };
    const guard = makeGuard(prisma);
    const ctx = makeContext({
      userId: "u1",
      authUserId: "a1",
      email: "admin@opsflow.io",
      role: "USER",
      isSuperadmin: false,
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const req = ctx.switchToHttp().getRequest() as {
      user: { platformAdminId: string };
      requestContext: { kind: string; isPlatformAdmin: boolean };
    };
    expect(req.user.platformAdminId).toBe("pa-1");
    expect(req.requestContext.kind).toBe(REQUEST_CONTEXT_KIND.PLATFORM_ADMIN);
    expect(req.requestContext.isPlatformAdmin).toBe(true);
  });

  it("denies tenant users access to platform routes", async () => {
    const prisma = {
      platformAdmin: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const guard = makeGuard(prisma);
    await expect(
      guard.canActivate(
        makeContext({
          userId: "u2",
          authUserId: "a2",
          email: "admin@tenant.com",
          role: "USER",
          isSuperadmin: false,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("denies DISABLED PlatformAdmin even if User.role is SUPERADMIN", async () => {
    const prisma = {
      platformAdmin: {
        findUnique: jest.fn().mockResolvedValue({
          id: "pa-2",
          status: PlatformAdminStatus.DISABLED,
        }),
      },
    };
    const guard = makeGuard(prisma);
    await expect(
      guard.canActivate(
        makeContext({
          userId: "u3",
          authUserId: "a3",
          email: "x@y.com",
          role: "SUPERADMIN",
          isSuperadmin: true,
        }),
      ),
    ).rejects.toThrow(/disabled/i);
  });

  it("denies unauthenticated requests", async () => {
    const prisma = {
      platformAdmin: { findUnique: jest.fn() },
    };
    const guard = makeGuard(prisma);
    await expect(guard.canActivate(makeContext(null))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("does not trust a client-only isPlatformAdmin without DB/legacy", async () => {
    const prisma = {
      platformAdmin: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const guard = makeGuard(prisma);
    await expect(
      guard.canActivate(
        makeContext({
          userId: "u4",
          authUserId: "a4",
          email: "x@y.com",
          role: "USER",
          isSuperadmin: false,
          isPlatformAdmin: true,
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows legacy SUPERADMIN when PlatformAdmin row is missing (transition)", async () => {
    const prisma = {
      platformAdmin: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const guard = makeGuard(prisma);
    await expect(
      guard.canActivate(
        makeContext({
          userId: "u5",
          authUserId: "a5",
          email: "legacy@opsflow.io",
          role: "SUPERADMIN",
          isSuperadmin: true,
        }),
      ),
    ).resolves.toBe(true);
  });
});
