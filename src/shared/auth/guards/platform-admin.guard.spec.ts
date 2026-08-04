import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { REQUEST_CONTEXT_KIND } from "../request-context";

describe("PlatformAdminGuard (Phase 0)", () => {
  const guard = new PlatformAdminGuard();

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

  it("allows legacy SUPERADMIN and attaches PLATFORM_ADMIN context", () => {
    const ctx = makeContext({
      userId: "u1",
      authUserId: "a1",
      email: "admin@opsflow.io",
      role: "SUPERADMIN",
      isSuperadmin: true,
    });
    expect(guard.canActivate(ctx)).toBe(true);
    const req = ctx.switchToHttp().getRequest() as {
      requestContext: { kind: string; isPlatformAdmin: boolean };
    };
    expect(req.requestContext.kind).toBe(REQUEST_CONTEXT_KIND.PLATFORM_ADMIN);
    expect(req.requestContext.isPlatformAdmin).toBe(true);
  });

  it("denies ordinary ADMIN (tenant role is irrelevant)", () => {
    expect(() =>
      guard.canActivate(
        makeContext({
          userId: "u2",
          authUserId: "a2",
          email: "admin@tenant.com",
          role: "USER",
          isSuperadmin: false,
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("denies unauthenticated requests", () => {
    expect(() => guard.canActivate(makeContext(null))).toThrow(
      ForbiddenException,
    );
  });

  it("does not trust a client-only isPlatformAdmin without SUPERADMIN", () => {
    // request.user comes from AuthGuard only; simulate a forged shape without isSuperadmin
    expect(() =>
      guard.canActivate(
        makeContext({
          userId: "u3",
          authUserId: "a3",
          email: "x@y.com",
          role: "USER",
          isSuperadmin: false,
          // Forged client field must not grant access
          isPlatformAdmin: true,
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});
