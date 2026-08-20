import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CanonicalTenantRole, Role } from "@prisma/client";
import { StrictCanonicalRoleGuard } from "./strict-canonical-role.guard";
import { Roles } from "./role.guard";
import { AUTH_MODE } from "../request-context";

describe("StrictCanonicalRoleGuard", () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };
  const guard = new StrictCanonicalRoleGuard(
    reflector as unknown as Reflector,
  );

  function ctx(tenant: Record<string, unknown>) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ tenant }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
  }

  beforeEach(() => {
    reflector.getAllAndOverride.mockReset();
    reflector.getAllAndOverride.mockReturnValue([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.FINANCE_ADMIN,
    ]);
  });

  it("allows FINANCE_ADMIN or TENANT_ADMIN from roles[]", () => {
    expect(
      guard.canActivate(
        ctx({
          tenantId: "t1",
          role: Role.FINANCE,
          roles: [CanonicalTenantRole.FINANCE_ADMIN],
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(
        ctx({
          tenantId: "t1",
          role: Role.ADMIN,
          roles: [CanonicalTenantRole.TENANT_ADMIN],
        }),
      ),
    ).toBe(true);
  });

  it("denies empty/missing roles[] even when singular role looks like Finance", () => {
    expect(() =>
      guard.canActivate(
        ctx({
          tenantId: "t1",
          role: Role.FINANCE,
          roles: [],
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(
        ctx({
          tenantId: "t1",
          role: Role.FINANCE,
        }),
      ),
    ).toThrow(/roles\[\]/i);
  });

  it("denies Transport and Driver roles[]", () => {
    expect(() =>
      guard.canActivate(
        ctx({
          tenantId: "t1",
          role: Role.TRANSPORT_STAFF,
          roles: [CanonicalTenantRole.TRANSPORT_ADMIN],
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(
        ctx({
          tenantId: "t1",
          role: Role.DRIVER,
          roles: [CanonicalTenantRole.TRANSPORT_DRIVER],
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("allows Platform Admin only with PLATFORM_TENANT_OPERATION", () => {
    expect(
      guard.canActivate(
        ctx({
          tenantId: "t1",
          role: Role.ADMIN,
          roles: [],
          isPlatformAdmin: true,
          authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
        }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(
        ctx({
          tenantId: null,
          role: Role.ADMIN,
          roles: [],
          isPlatformAdmin: true,
          authMode: AUTH_MODE.PLATFORM_CONTROL,
        }),
      ),
    ).toThrow();
  });
});

describe("Roles decorator export used by strict guard metadata", () => {
  it("exports Roles for metadata", () => {
    expect(typeof Roles).toBe("function");
  });
});
