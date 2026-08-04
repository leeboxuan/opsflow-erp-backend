import { BadRequestException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  DestructiveActionGuard,
  sanitizeDestructiveReason,
} from "./destructive-action.guard";
import { DESTRUCTIVE_ACTION_KEY } from "./destructive-action.decorator";
import {
  AUTH_MODE,
  REQUEST_CONTEXT_KIND,
} from "../request-context";

describe("sanitizeDestructiveReason", () => {
  it("trims, strips controls, and bounds length", () => {
    expect(sanitizeDestructiveReason("  ok  ")).toBe("ok");
    expect(sanitizeDestructiveReason("a\u0000b")).toBe("a b");
    expect(sanitizeDestructiveReason("x".repeat(600))?.length).toBe(500);
    expect(sanitizeDestructiveReason("   ")).toBeNull();
    expect(sanitizeDestructiveReason(null)).toBeNull();
  });
});

describe("DestructiveActionGuard", () => {
  function makeCtx(meta: any, request: any) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(meta),
    } as unknown as Reflector;
    const guard = new DestructiveActionGuard(reflector);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
    return { guard, context, reflector };
  }

  it("passes when no meta", () => {
    const { guard, context } = makeCtx(undefined, { body: {} });
    expect(guard.canActivate(context)).toBe(true);
  });

  it("requires reason for Platform Admin operating mode", () => {
    const request: any = {
      body: {},
      requestContext: {
        kind: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
        actorType: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
        isPlatformAdmin: true,
        platformAdminId: "pa1",
        authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
        tenantId: "t1",
        userId: "u1",
        authUserId: "a1",
        email: "x@y.z",
        role: "SUPERADMIN",
      },
    };
    const { guard, context } = makeCtx(
      { requireReasonForPlatformAdmin: true },
      request,
    );
    expect(() => guard.canActivate(context)).toThrow(BadRequestException);
  });

  it("accepts sanitized reason for Platform Admin", () => {
    const request: any = {
      body: { reason: "  customer request  " },
      requestContext: {
        kind: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
        actorType: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
        isPlatformAdmin: true,
        platformAdminId: "pa1",
        authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
        tenantId: "t1",
        userId: "u1",
        authUserId: "a1",
        email: "x@y.z",
        role: "SUPERADMIN",
      },
    };
    const { guard, context } = makeCtx(
      { requireReasonForPlatformAdmin: true },
      request,
    );
    expect(guard.canActivate(context)).toBe(true);
    expect(request.destructiveReason).toBe("customer request");
    expect(request.body.reason).toBe("customer request");
  });

  it("does not require reason for ordinary tenant users", () => {
    const request: any = {
      body: {},
      requestContext: {
        kind: REQUEST_CONTEXT_KIND.TENANT_USER,
        actorType: REQUEST_CONTEXT_KIND.TENANT_USER,
        isPlatformAdmin: false,
        platformAdminId: null,
        authMode: AUTH_MODE.MEMBERSHIP,
        tenantId: "t1",
        userId: "u1",
        authUserId: "a1",
        email: "x@y.z",
        role: "USER",
      },
    };
    const { guard, context } = makeCtx(
      { requireReasonForPlatformAdmin: true },
      request,
    );
    expect(guard.canActivate(context)).toBe(true);
  });

  it("registers metadata key", () => {
    expect(DESTRUCTIVE_ACTION_KEY).toBe("destructiveAction");
  });
});
