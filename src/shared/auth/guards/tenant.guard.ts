import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../prisma/prisma.service";
import { MembershipStatus, Role, TenantStatus } from "@prisma/client";
import { SKIP_TENANT_GUARD_KEY } from "./skip-tenant-guard.decorator";
import {
  readTenantContextCache,
  tenantContextCacheKey,
  writeTenantContextCache,
  type CachedTenantContext,
} from "../tenant-context.cache";
import {
  attachRequestContext,
  buildRequestContext,
} from "../request-context";

/**
 * Resolves X-Tenant-Id into request.tenant for ordinary tenant APIs.
 *
 * Security notes (Platform Super Admin):
 * - Platform authority is PlatformAdmin ACTIVE (DB), with legacy SUPERADMIN bridge.
 * - SUPERADMIN is not a tenant Role.
 * - Never trust client-supplied role / isSuperadmin / isPlatformAdmin flags.
 * - SUSPENDED tenants: ordinary users blocked; Platform Admin allowed with
 *   tenantSuspended: true on request context.
 * - SETUP: Platform Admin may access for configuration; ordinary Active members allowed.
 */
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

    const isPlatformAdmin = await this.resolveIsPlatformAdmin(user);

    if (isPlatformAdmin) {
      if (!tenantIdHeader) {
        request.tenant = {
          tenantId: null,
          role: Role.ADMIN,
          isSuperadmin: true,
          isPlatformAdmin: true,
          tenantSuspended: false,
        };
        this.attachCtx(request, user, null, false);
        return true;
      }

      const cacheKey = tenantContextCacheKey(user.userId, tenantIdHeader);
      const cached = readTenantContextCache(cacheKey);
      if (cached) {
        request.tenant = cached;
        this.attachCtx(
          request,
          user,
          cached.tenantId,
          cached.tenantSuspended === true,
        );
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

      const tenantSuspended =
        (tenant as any).status === TenantStatus.SUSPENDED ||
        (tenant as any).status === "SUSPENDED";

      // ARCHIVED: platform admin may still read/manage via /platform; ops routes blocked.
      if ((tenant as any).status === TenantStatus.ARCHIVED || (tenant as any).status === "ARCHIVED") {
        throw new ForbiddenException(
          "Tenant is archived — use /platform APIs for management",
        );
      }

      const tenantContext: CachedTenantContext = {
        tenantId: tenantIdHeader,
        role: membership?.role ?? Role.ADMIN,
        isSuperadmin: true,
        isPlatformAdmin: true,
        tenantSuspended,
      };
      writeTenantContextCache(cacheKey, tenantContext);
      request.tenant = tenantContext;
      this.attachCtx(request, user, tenantIdHeader, tenantSuspended);
      return true;
    }

    if (!tenantIdHeader) {
      throw new BadRequestException("X-Tenant-Id header is required");
    }

    const cacheKey = tenantContextCacheKey(user.userId, tenantIdHeader);
    const cached = readTenantContextCache(cacheKey);
    if (cached) {
      if (cached.tenantSuspended) {
        throw new ForbiddenException("Tenant is suspended");
      }
      request.tenant = cached;
      this.attachCtx(request, user, cached.tenantId, false);
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

    const tenantStatus = (membership.tenant as any)?.status as
      | TenantStatus
      | string
      | undefined;

    if (
      tenantStatus === TenantStatus.SUSPENDED ||
      tenantStatus === "SUSPENDED"
    ) {
      throw new ForbiddenException("Tenant is suspended");
    }

    if (
      tenantStatus === TenantStatus.ARCHIVED ||
      tenantStatus === "ARCHIVED"
    ) {
      throw new ForbiddenException("Tenant is archived");
    }

    const tenantContext: CachedTenantContext = {
      tenantId: tenantIdHeader,
      role: membership.role,
      isSuperadmin: false,
      isPlatformAdmin: false,
      tenantSuspended: false,
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
    this.attachCtx(request, user, tenantIdHeader, false);
    return true;
  }

  private async resolveIsPlatformAdmin(user: {
    userId: string;
    isSuperadmin?: boolean;
    isPlatformAdmin?: boolean;
    platformAdminId?: string | null;
    role?: string;
  }): Promise<boolean> {
    try {
      const row = await this.prisma.platformAdmin.findUnique({
        where: { userId: user.userId },
        select: { id: true, status: true },
      });
      if (row?.status === "DISABLED") {
        // Explicit disable wins over legacy SUPERADMIN bridge.
        user.isPlatformAdmin = false;
        user.isSuperadmin = false;
        user.platformAdminId = row.id;
        return false;
      }
      if (row?.status === "ACTIVE") {
        user.platformAdminId = row.id;
        user.isPlatformAdmin = true;
        user.isSuperadmin = true;
        return true;
      }
    } catch {
      // pre-migration
    }
    if (user.isPlatformAdmin === true && user.platformAdminId) {
      return true;
    }
    return user.isSuperadmin === true || user.role === "SUPERADMIN";
  }

  private attachCtx(
    request: any,
    user: any,
    tenantId: string | null,
    tenantSuspended: boolean,
  ) {
    const ctx = buildRequestContext({
      userId: user.userId,
      authUserId: user.authUserId ?? "",
      email: user.email ?? "",
      role: user.role ?? "USER",
      platformAdminId: user.platformAdminId ?? null,
      legacySuperadminAsPlatformAdmin: user.isSuperadmin === true,
      tenantId,
      tenantSuspended,
    });
    attachRequestContext(request, ctx);
  }
}
