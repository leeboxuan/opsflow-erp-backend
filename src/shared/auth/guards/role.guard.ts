import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CanonicalTenantRole, Role } from '@prisma/client';
import { hasAnyRole, toCanonicalTenantRoles } from '../canonical-tenant-role';
import {
  AUTH_MODE,
  isPlatformTenantOperation,
  readRequestContext,
} from '../request-context';

export type RoleRequirement = Role | CanonicalTenantRole | string;

export const Roles = (...roles: RoleRequirement[]) => SetMetadata('roles', roles);

/**
 * Role / permission guard for tenant-scoped routes.
 *
 * Multi-role: @Roles(A, B) is ANY/OR — passes if the actor has either role.
 * Legacy aliases (ADMIN≡TENANT_ADMIN, DRIVER≡TRANSPORT_DRIVER, …) are
 * resolved centrally via hasAnyRole.
 *
 * Platform Admin operating a tenant receives TENANT_ADMIN-class authority
 * without a synthetic TenantMembership.
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const requiredRoles = this.getRoles(context);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const tenant = request.tenant;
    if (!tenant || (!tenant.role && !tenant.roles?.length)) {
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

    const userRoles = platformOps
      ? [CanonicalTenantRole.TENANT_ADMIN]
      : tenant.roles?.length
        ? toCanonicalTenantRoles(tenant.roles)
        : toCanonicalTenantRoles([tenant.role]);

    if (!hasAnyRole(userRoles, requiredRoles)) {
      throw new ForbiddenException(
        `Required role: ${requiredRoles.join(' or ')}`,
      );
    }

    return true;
  }

  private getRoles(context: ExecutionContext): RoleRequirement[] {
    return (
      this.reflector.getAllAndOverride<RoleRequirement[]>('roles', [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    );
  }
}
