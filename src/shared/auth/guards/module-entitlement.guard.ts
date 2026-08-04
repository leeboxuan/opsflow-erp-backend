import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TenantModule } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export const REQUIRES_TENANT_MODULE_KEY = "requiresTenantModule";

/**
 * Declare that a controller/route requires a tenant module entitlement.
 * Enforced by ModuleEntitlementGuard after TenantGuard.
 */
export const RequiresTenantModule = (...modules: TenantModule[]) =>
  SetMetadata(REQUIRES_TENANT_MODULE_KEY, modules);

/**
 * Central module-entitlement gate for operational route families.
 * Applies where controllers opt in via @RequiresTenantModule.
 * Does not bypass domain validation inside services.
 */
@Injectable()
export class ModuleEntitlementGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<TenantModule[]>(
      REQUIRES_TENANT_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantId = request.tenant?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException(
        "Tenant context not found. TenantGuard must be applied first.",
      );
    }

    for (const module of required) {
      const row = await this.prisma.tenantModuleEntitlement.findUnique({
        where: { tenantId_module: { tenantId, module } },
        select: { enabled: true },
      });
      if (!row?.enabled) {
        throw new ForbiddenException(
          `Tenant module ${module} is not enabled`,
        );
      }
    }
    return true;
  }
}
