import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CanonicalTenantRole } from '@prisma/client';
import { Observable } from 'rxjs';
import {
  isCustomerAdminOnly,
  isTransportDriverOnly,
} from '../access-surface';
import { actorRolesFromRequest } from '../access-actor';
import { hasRole } from '../canonical-tenant-role';
import {
  AUTH_MODE,
  isPlatformTenantOperation,
  readRequestContext,
} from '../request-context';

export const ACCESS_SURFACE_KEY = 'accessSurface';

/** Default for tenant-scoped routes is `staff` (fail closed). */
export type AccessSurfaceName = 'staff' | 'driver' | 'portal' | 'member';

export const AccessSurface = (surface: AccessSurfaceName) =>
  SetMetadata(ACCESS_SURFACE_KEY, surface);

/**
 * Fail-closed tenant API surface policy.
 *
 * Does not trust clientApp, sidebar, or frontend guards.
 * Driver-only and customer-only tokens cannot hit staff APIs even when a
 * controller omits @Roles.
 *
 * Opt-in: @AccessSurface('driver' | 'portal' | 'member').
 * Mixed TRANSPORT_DRIVER + office/admin may use staff and driver surfaces.
 */
@Injectable()
export class AccessSurfaceInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const tenant = request?.tenant;
    if (!tenant?.tenantId) {
      return next.handle();
    }

    const ctx = readRequestContext(request);
    const platformOps =
      isPlatformTenantOperation(ctx) ||
      (tenant.isPlatformAdmin === true &&
        tenant.authMode === AUTH_MODE.PLATFORM_TENANT_OPERATION);
    if (platformOps) {
      return next.handle();
    }

    const surface =
      this.reflector.getAllAndOverride<AccessSurfaceName>(ACCESS_SURFACE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'staff';

    const roles = actorRolesFromRequest(request);
    const driverOnly = isTransportDriverOnly(roles);
    const customerOnly = isCustomerAdminOnly(roles);

    if (surface === 'member') {
      return next.handle();
    }

    if (surface === 'staff') {
      if (driverOnly) {
        throw new ForbiddenException('This account is for the Driver app only');
      }
      if (customerOnly) {
        throw new ForbiddenException(
          'Customer Admin accounts cannot access staff APIs',
        );
      }
      return next.handle();
    }

    if (surface === 'driver') {
      if (!hasRole(roles, CanonicalTenantRole.TRANSPORT_DRIVER)) {
        throw new ForbiddenException(
          'Driver Mobile is only available to Transport Drivers',
        );
      }
      return next.handle();
    }

    if (surface === 'portal') {
      if (driverOnly) {
        throw new ForbiddenException('This account is for the Driver app only');
      }
      return next.handle();
    }

    return next.handle();
  }
}
