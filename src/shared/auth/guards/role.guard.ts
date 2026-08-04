import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { roleSatisfiesRequirement } from '../role-compat';
import {
  AUTH_MODE,
  isPlatformTenantOperation,
  readRequestContext,
} from '../request-context';

export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

/**
 * Role / permission guard for tenant-scoped routes.
 *
 * Phase 3: ACTIVE Platform Admin with a validated selected tenant receives
 * ADMIN-class effective permissions centrally here (and via request context
 * authMode=PLATFORM_TENANT_OPERATION). Controllers must not scatter
 * `platformAdmin || role` checks.
 *
 * Ordinary tenant-user authorization is unchanged (membership role only).
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const requiredRoles = this.getRoles(context);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // No roles required
    }

    const tenant = request.tenant;
    if (!tenant || !tenant.role) {
      throw new ForbiddenException(
        'Tenant context not found. TenantGuard must be applied first.',
      );
    }

    const ctx = readRequestContext(request);
    const platformOps =
      isPlatformTenantOperation(ctx) ||
      (tenant.isPlatformAdmin === true &&
        !!tenant.tenantId &&
        tenant.authMode === AUTH_MODE.PLATFORM_TENANT_OPERATION);

    // Centralized ADMIN-class effective role for platform tenant operation.
    const userRole: Role = platformOps
      ? Role.ADMIN
      : (tenant.role as Role);

    if (!roleSatisfiesRequirement(userRole, requiredRoles)) {
      throw new ForbiddenException(
        `Required role: ${requiredRoles.join(' or ')}`,
      );
    }

    return true;
  }

  private getRoles(context: ExecutionContext): Role[] {
    return (
      this.reflector.getAllAndOverride<Role[]>('roles', [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    );
  }
}
