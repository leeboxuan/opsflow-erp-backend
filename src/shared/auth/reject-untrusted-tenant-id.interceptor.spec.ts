import { BadRequestException } from "@nestjs/common";
import { RejectUntrustedTenantIdInterceptor } from "./reject-untrusted-tenant-id.interceptor";
import {
  AUTH_MODE,
  REQUEST_CONTEXT_KIND,
} from "./request-context";

describe("RejectUntrustedTenantIdInterceptor", () => {
  const interceptor = new RejectUntrustedTenantIdInterceptor();

  function run(request: any) {
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;
    const next = { handle: () => ({ subscribe: () => undefined }) } as any;
    return interceptor.intercept(context, next);
  }

  it("rejects body tenantId mismatch against trusted context", () => {
    const request: any = {
      url: "/jobs",
      body: { tenantId: "other" },
      query: {},
      params: {},
      tenant: { tenantId: "t1" },
      requestContext: {
        kind: REQUEST_CONTEXT_KIND.TENANT_USER,
        actorType: REQUEST_CONTEXT_KIND.TENANT_USER,
        isPlatformAdmin: false,
        platformAdminId: null,
        authMode: AUTH_MODE.MEMBERSHIP,
        tenantId: "t1",
        userId: "u1",
        authUserId: "a1",
        email: "a@b.c",
        role: "USER",
      },
    };
    expect(() => run(request)).toThrow(BadRequestException);
  });

  it("allows matching tenantId", () => {
    const request: any = {
      url: "/jobs",
      body: { tenantId: "t1" },
      query: {},
      params: {},
      tenant: { tenantId: "t1" },
      requestContext: {
        kind: REQUEST_CONTEXT_KIND.TENANT_USER,
        actorType: REQUEST_CONTEXT_KIND.TENANT_USER,
        isPlatformAdmin: false,
        platformAdminId: null,
        authMode: AUTH_MODE.MEMBERSHIP,
        tenantId: "t1",
        userId: "u1",
        authUserId: "a1",
        email: "a@b.c",
        role: "USER",
      },
    };
    expect(() => run(request)).not.toThrow();
  });

  it("allows platform path tenantId params", () => {
    const request: any = {
      url: "/platform/tenants/t2",
      body: {},
      query: {},
      params: { tenantId: "t2" },
      tenant: { tenantId: "t1" },
      requestContext: {
        kind: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
        actorType: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
        isPlatformAdmin: true,
        platformAdminId: "pa1",
        authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
        tenantId: "t1",
        userId: "u1",
        authUserId: "a1",
        email: "a@b.c",
        role: "SUPERADMIN",
      },
    };
    expect(() => run(request)).not.toThrow();
  });
});
