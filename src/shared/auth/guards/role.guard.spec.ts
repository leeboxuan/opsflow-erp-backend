import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CanonicalTenantRole, Role } from '@prisma/client';
import { RoleGuard, Roles } from './role.guard';
import { AUTH_MODE } from '../request-context';

function ctx(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as ExecutionContext;
}

describe('RoleGuard multi-role', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };
  const guard = new RoleGuard(reflector as unknown as Reflector);

  beforeEach(() => {
    reflector.getAllAndOverride.mockReset();
  });

  it('passes when the actor has any required role (OR semantics)', () => {
    reflector.getAllAndOverride.mockReturnValue([
      Role.ADMIN,
      Role.TRANSPORT_STAFF,
    ]);
    expect(
      guard.canActivate(
        ctx({
          tenant: {
            tenantId: 't1',
            role: Role.FINANCE,
            roles: [CanonicalTenantRole.FINANCE_ADMIN, CanonicalTenantRole.TRANSPORT_ADMIN],
          },
        }),
      ),
    ).toBe(true);
  });

  it('maps ADMIN requirement to TENANT_ADMIN', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    expect(
      guard.canActivate(
        ctx({
          tenant: {
            tenantId: 't1',
            role: Role.ADMIN,
            roles: [CanonicalTenantRole.TENANT_ADMIN],
          },
        }),
      ),
    ).toBe(true);
  });

  it('maps DRIVER requirement to TRANSPORT_DRIVER and rejects TRANSPORT_ADMIN', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.DRIVER]);
    expect(() =>
      guard.canActivate(
        ctx({
          tenant: {
            tenantId: 't1',
            role: Role.TRANSPORT_STAFF,
            roles: [CanonicalTenantRole.TRANSPORT_ADMIN],
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('treats Platform Admin operating a tenant as TENANT_ADMIN', () => {
    reflector.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    expect(
      guard.canActivate(
        ctx({
          tenant: {
            tenantId: 't1',
            role: Role.ADMIN,
            roles: [CanonicalTenantRole.TENANT_ADMIN],
            isPlatformAdmin: true,
            authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
          },
          requestContext: {
            kind: 'PLATFORM_ADMIN',
            authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
            tenantId: 't1',
            isPlatformAdmin: true,
          },
        }),
      ),
    ).toBe(true);
  });

  it("falls back to legacy singular role when roles[] is empty", () => {
    reflector.getAllAndOverride.mockReturnValue([Role.WAREHOUSE]);
    expect(
      guard.canActivate(
        ctx({
          tenant: { tenantId: 't1', role: Role.WAREHOUSE, roles: [] },
        }),
      ),
    ).toBe(true);
  });

  it("does not treat WAREHOUSE_ADMIN as WAREHOUSE_STAFF for Role.WAREHOUSE", () => {
    reflector.getAllAndOverride.mockReturnValue([Role.WAREHOUSE]);
    expect(() =>
      guard.canActivate(
        ctx({
          tenant: {
            tenantId: 't1',
            role: Role.WAREHOUSE,
            roles: [CanonicalTenantRole.WAREHOUSE_ADMIN],
          },
        }),
      ),
    ).toThrow(ForbiddenException);
  });
});

describe('Roles decorator', () => {
  it('is exported for ANY/OR metadata', () => {
    expect(typeof Roles).toBe('function');
  });
});
