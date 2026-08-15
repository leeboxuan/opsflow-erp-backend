import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { canAccessStaffWeb } from '../access-surface';
import { toCanonicalTenantRoles } from '../canonical-tenant-role';
import {
  AUTH_MODE,
  isPlatformTenantOperation,
  readRequestContext,
} from '../request-context';

/**
 * Staff web / ERP surfaces. TRANSPORT_DRIVER-only accounts are denied.
 * Driver Mobile endpoints must not use this guard.
 */
@Injectable()
export class StaffWebGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const tenant = request.tenant;
    const ctx = readRequestContext(request);
    const platformOps =
      isPlatformTenantOperation(ctx) ||
      (tenant?.isPlatformAdmin === true &&
        !!tenant?.tenantId &&
        tenant.authMode === AUTH_MODE.PLATFORM_TENANT_OPERATION);
    if (platformOps) return true;

    const roles = tenant?.roles?.length
      ? toCanonicalTenantRoles(tenant.roles)
      : toCanonicalTenantRoles(tenant?.role ? [tenant.role] : []);

    if (!canAccessStaffWeb(roles)) {
      throw new ForbiddenException('This account is for the Driver app only');
    }
    return true;
  }
}
