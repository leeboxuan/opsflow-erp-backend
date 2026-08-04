import {
  AUTH_MODE,
  REQUEST_CONTEXT_KIND,
  attachRequestContext,
  buildRequestContext,
  isPlatformAdminContext,
  isPlatformTenantOperation,
  isTenantUserContext,
  readCorrelationId,
  readRequestContext,
} from "./request-context";
import { Role, TenantStatus } from "@prisma/client";

describe("request-context", () => {
  const base = {
    userId: "user-1",
    authUserId: "auth-1",
    email: "a@example.com",
    role: "USER",
  };

  it("builds TENANT_USER context for ordinary users", () => {
    const ctx = buildRequestContext({
      ...base,
      membershipRole: Role.ADMIN,
    });
    expect(ctx.kind).toBe(REQUEST_CONTEXT_KIND.TENANT_USER);
    expect(ctx.actorType).toBe(REQUEST_CONTEXT_KIND.TENANT_USER);
    expect(ctx.isPlatformAdmin).toBe(false);
    expect(ctx.platformAdminId).toBeNull();
    expect(ctx.authMode).toBe(AUTH_MODE.MEMBERSHIP);
    expect(ctx.effectiveRole).toBe(Role.ADMIN);
    expect(isTenantUserContext(ctx)).toBe(true);
    expect(isPlatformAdminContext(ctx)).toBe(false);
  });

  it("builds PLATFORM_ADMIN from legacy SUPERADMIN when enabled", () => {
    const ctx = buildRequestContext({ ...base, role: "SUPERADMIN" });
    expect(ctx.kind).toBe(REQUEST_CONTEXT_KIND.PLATFORM_ADMIN);
    expect(ctx.actorType).toBe(REQUEST_CONTEXT_KIND.PLATFORM_ADMIN);
    expect(ctx.isPlatformAdmin).toBe(true);
    expect(ctx.platformAdminId).toBeNull();
    expect(ctx.authMode).toBe(AUTH_MODE.PLATFORM_CONTROL);
    expect(isPlatformAdminContext(ctx)).toBe(true);
  });

  it("builds PLATFORM_ADMIN from platformAdminId even without SUPERADMIN role", () => {
    const ctx = buildRequestContext({
      ...base,
      role: "USER",
      platformAdminId: "pa-1",
      legacySuperadminAsPlatformAdmin: false,
    });
    expect(ctx.kind).toBe(REQUEST_CONTEXT_KIND.PLATFORM_ADMIN);
    expect(ctx.platformAdminId).toBe("pa-1");
    expect(ctx.authMode).toBe(AUTH_MODE.PLATFORM_CONTROL);
  });

  it("does not treat SUPERADMIN as platform admin when legacy flag is false and no row", () => {
    const ctx = buildRequestContext({
      ...base,
      role: "SUPERADMIN",
      legacySuperadminAsPlatformAdmin: false,
    });
    expect(ctx.kind).toBe(REQUEST_CONTEXT_KIND.TENANT_USER);
    expect(ctx.isPlatformAdmin).toBe(false);
  });

  it("carries optional tenant selection and suspended flag", () => {
    const ctx = buildRequestContext({
      ...base,
      role: "SUPERADMIN",
      tenantId: "t-1",
      tenantSuspended: true,
      tenantStatus: TenantStatus.SUSPENDED,
    });
    expect(ctx.tenantId).toBe("t-1");
    expect(ctx.tenantSuspended).toBe(true);
    expect(ctx.tenantStatus).toBe(TenantStatus.SUSPENDED);
  });

  it("builds PLATFORM_TENANT_OPERATION with ADMIN effective role", () => {
    const ctx = buildRequestContext({
      ...base,
      platformAdminId: "pa-1",
      tenantId: "t-1",
      tenantStatus: TenantStatus.ACTIVE,
      platformTenantOperation: true,
      correlationId: "corr-1",
    });
    expect(ctx.authMode).toBe(AUTH_MODE.PLATFORM_TENANT_OPERATION);
    expect(ctx.effectiveRole).toBe(Role.ADMIN);
    expect(ctx.correlationId).toBe("corr-1");
    expect(isPlatformTenantOperation(ctx)).toBe(true);
  });

  it("attach/read request context on request object", () => {
    const req: { requestContext?: ReturnType<typeof buildRequestContext> } =
      {};
    const ctx = buildRequestContext(base);
    attachRequestContext(req, ctx);
    expect(readRequestContext(req)).toEqual(ctx);
    expect(readRequestContext(null)).toBeNull();
  });

  it("reads correlation id from headers", () => {
    expect(readCorrelationId({ "x-request-id": "r1" })).toBe("r1");
    expect(readCorrelationId({ "x-correlation-id": "c1" })).toBe("c1");
    expect(readCorrelationId({})).toBeNull();
  });
});
