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

export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

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

    const userRole = tenant.role;
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
