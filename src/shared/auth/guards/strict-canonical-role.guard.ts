import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CanonicalTenantRole } from "@prisma/client";
import { hasAnyRole, toCanonicalTenantRoles } from "../canonical-tenant-role";
import {
  AUTH_MODE,
  isPlatformTenantOperation,
  readRequestContext,
} from "../request-context";
import { type RoleRequirement } from "./role.guard";

/**
 * Strict role guard for Finance-sensitive Phase 3 surfaces.
 *
 * Unlike {@link RoleGuard}, this **never** falls back to the legacy singular
 * `tenant.role` when `roles[]` is empty or missing. Authorization requires
 * non-empty canonical `roles[]`, except Platform Admin in
 * `PLATFORM_TENANT_OPERATION` (elevated to TENANT_ADMIN).
 *
 * Uses the same `@Roles(...)` metadata as RoleGuard.
 */
@Injectable()
export class StrictCanonicalRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const requiredRoles = this.getRoles(context);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const tenant = request.tenant;
    if (!tenant) {
      throw new ForbiddenException(
        "Tenant context not found. TenantGuard must be applied first.",
      );
    }

    const ctx = readRequestContext(request);
    const platformOps =
      isPlatformTenantOperation(ctx) ||
      (tenant.isPlatformAdmin === true &&
        !!tenant.tenantId &&
        tenant.authMode === AUTH_MODE.PLATFORM_TENANT_OPERATION);

    if (platformOps) {
      if (!hasAnyRole([CanonicalTenantRole.TENANT_ADMIN], requiredRoles)) {
        throw new ForbiddenException(
          `Required role: ${requiredRoles.join(" or ")}`,
        );
      }
      return true;
    }

    const canonical = Array.isArray(tenant.roles)
      ? toCanonicalTenantRoles(tenant.roles)
      : [];

    if (canonical.length === 0) {
      throw new ForbiddenException(
        "Canonical tenant roles[] are required; legacy singular role is not sufficient.",
      );
    }

    if (!hasAnyRole(canonical, requiredRoles)) {
      throw new ForbiddenException(
        `Required role: ${requiredRoles.join(" or ")}`,
      );
    }

    return true;
  }

  private getRoles(context: ExecutionContext): RoleRequirement[] {
    return (
      this.reflector.getAllAndOverride<RoleRequirement[]>("roles", [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    );
  }
}
