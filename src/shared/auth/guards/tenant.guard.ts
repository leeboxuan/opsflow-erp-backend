import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../prisma/prisma.service";
import { MembershipStatus, Role } from "@prisma/client";
import { SKIP_TENANT_GUARD_KEY } from "./skip-tenant-guard.decorator";
import {
  readTenantContextCache,
  tenantContextCacheKey,
  writeTenantContextCache,
  type CachedTenantContext,
} from "../tenant-context.cache";

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skipTenantGuard = this.reflector.getAllAndOverride<boolean>(
      SKIP_TENANT_GUARD_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipTenantGuard) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantIdHeader = request.headers["x-tenant-id"];
    const user = request.user;

    if (!user || !user.userId) {
      throw new ForbiddenException("User must be authenticated first");
    }

    if (user.isSuperadmin) {
      if (!tenantIdHeader) {
        request.tenant = {
          tenantId: null,
          role: Role.ADMIN,
          isSuperadmin: true,
        };
        return true;
      }

      const cacheKey = tenantContextCacheKey(user.userId, tenantIdHeader);
      const cached = readTenantContextCache(cacheKey);
      if (cached) {
        request.tenant = cached;
        return true;
      }

      const tenant = await this.prisma.tenant.findFirst({
        where: { id: tenantIdHeader },
      });
      if (!tenant) {
        throw new BadRequestException("Tenant not found");
      }

      const membership = await this.prisma.tenantMembership.findFirst({
        where: {
          tenantId: tenantIdHeader,
          userId: user.userId,
        },
        select: { role: true, status: true },
      });

      if (membership?.status === MembershipStatus.Suspended) {
        throw new ForbiddenException("Account suspended");
      }

      const tenantContext: CachedTenantContext = {
        tenantId: tenantIdHeader,
        role: membership?.role ?? Role.ADMIN,
        isSuperadmin: true,
      };
      writeTenantContextCache(cacheKey, tenantContext);
      request.tenant = tenantContext;
      return true;
    }

    if (!tenantIdHeader) {
      throw new BadRequestException("X-Tenant-Id header is required");
    }

    const cacheKey = tenantContextCacheKey(user.userId, tenantIdHeader);
    const cached = readTenantContextCache(cacheKey);
    if (cached) {
      request.tenant = cached;
      return true;
    }

    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        tenantId: tenantIdHeader,
        userId: user.userId,
      },
      include: {
        tenant: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException("User is not a member of this tenant");
    }

    if (membership.status !== MembershipStatus.Active) {
      throw new ForbiddenException(
        `Membership is not Active (${membership.status})`,
      );
    }

    const tenantContext: CachedTenantContext = {
      tenantId: tenantIdHeader,
      role: membership.role,
      isSuperadmin: false,
    };

    if (membership.role === Role.CUSTOMER) {
      const u = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: { customerCompanyId: true, customerContactId: true },
      });

      if (!u?.customerCompanyId) {
        throw new ForbiddenException(
          "CUSTOMER user is missing customerCompanyId. Admin must link them to a customer company.",
        );
      }

      const company = await this.prisma.customer_companies.findFirst({
        where: { id: u.customerCompanyId, tenantId: tenantIdHeader },
        select: { isActive: true },
      });

      if (!company || company.isActive === false) {
        throw new ForbiddenException("Customer company is suspended");
      }

      tenantContext.customerCompanyId = u.customerCompanyId;
      tenantContext.customerContactId = u.customerContactId ?? null;
    }

    writeTenantContextCache(cacheKey, tenantContext);
    request.tenant = tenantContext;
    return true;
  }
}
