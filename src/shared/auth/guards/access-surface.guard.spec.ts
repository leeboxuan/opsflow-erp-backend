import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { of } from 'rxjs';
import { CanonicalTenantRole } from '@prisma/client';
import { AUTH_MODE } from '../request-context';
import {
  AccessSurfaceInterceptor,
} from './access-surface.guard';

function ctx(request: unknown, surface?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as ExecutionContext;
}

describe('AccessSurfaceInterceptor', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };
  const interceptor = new AccessSurfaceInterceptor(reflector as any);
  const next = { handle: () => of('ok') };

  beforeEach(() => {
    reflector.getAllAndOverride.mockReset();
    reflector.getAllAndOverride.mockReturnValue(undefined);
  });

  it('skips routes without tenant context', () => {
    expect(() =>
      interceptor.intercept(ctx({}), next),
    ).not.toThrow();
  });

  it('defaults to staff and blocks TRANSPORT_DRIVER-only without @Roles', () => {
    expect(() =>
      interceptor.intercept(
        ctx({
          tenant: {
            tenantId: 't1',
            role: 'DRIVER',
            roles: [CanonicalTenantRole.TRANSPORT_DRIVER],
          },
        }),
        next,
      ),
    ).toThrow(/Driver app only/);
  });

  it('defaults to staff and blocks CUSTOMER_ADMIN-only', () => {
    expect(() =>
      interceptor.intercept(
        ctx({
          tenant: {
            tenantId: 't1',
            role: 'CUSTOMER',
            roles: [CanonicalTenantRole.CUSTOMER_ADMIN],
          },
        }),
        next,
      ),
    ).toThrow(/Customer Admin/);
  });

  it('allows mixed TRANSPORT_DRIVER + TRANSPORT_ADMIN on staff', () => {
    expect(() =>
      interceptor.intercept(
        ctx({
          tenant: {
            tenantId: 't1',
            role: 'TRANSPORT_STAFF',
            roles: [
              CanonicalTenantRole.TRANSPORT_DRIVER,
              CanonicalTenantRole.TRANSPORT_ADMIN,
            ],
          },
        }),
        next,
      ),
    ).not.toThrow();
  });

  it('allows driver-only on @AccessSurface(driver)', () => {
    reflector.getAllAndOverride.mockReturnValue('driver');
    expect(() =>
      interceptor.intercept(
        ctx({
          tenant: {
            tenantId: 't1',
            roles: [CanonicalTenantRole.TRANSPORT_DRIVER],
          },
        }),
        next,
      ),
    ).not.toThrow();
  });

  it('rejects staff-only actors on driver surface', () => {
    reflector.getAllAndOverride.mockReturnValue('driver');
    expect(() =>
      interceptor.intercept(
        ctx({
          tenant: {
            tenantId: 't1',
            roles: [CanonicalTenantRole.FINANCE_ADMIN],
          },
        }),
        next,
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows customer-only on portal surface', () => {
    reflector.getAllAndOverride.mockReturnValue('portal');
    expect(() =>
      interceptor.intercept(
        ctx({
          tenant: {
            tenantId: 't1',
            roles: [CanonicalTenantRole.CUSTOMER_ADMIN],
          },
        }),
        next,
      ),
    ).not.toThrow();
  });

  it('allows any membership on member surface including driver-only', () => {
    reflector.getAllAndOverride.mockReturnValue('member');
    expect(() =>
      interceptor.intercept(
        ctx({
          tenant: {
            tenantId: 't1',
            roles: [CanonicalTenantRole.TRANSPORT_DRIVER],
          },
        }),
        next,
      ),
    ).not.toThrow();
  });

  it('allows Platform Admin operating a tenant on the staff surface', () => {
    expect(() =>
      interceptor.intercept(
        ctx({
          tenant: {
            tenantId: 't1',
            isPlatformAdmin: true,
            authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
            roles: [CanonicalTenantRole.TENANT_ADMIN],
          },
        }),
        next,
      ),
    ).not.toThrow();
  });
});
