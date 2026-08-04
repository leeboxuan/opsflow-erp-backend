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
  AUTH_MODE,
  attachRequestContext,
  buildRequestContext,
  readCorrelationId,
} from "../request-context";

/**
 * Resolves X-Tenant-Id into request.tenant for ordinary tenant APIs.
 *
 * Security notes (Platform Super Admin / Phase 3):
 * - Platform authority is PlatformAdmin ACTIVE (DB), with legacy SUPERADMIN bridge.
 * - SUPERADMIN is not a tenant Role.
 * - Never trust client-supplied role / isSuperadmin / isPlatformAdmin flags.
 * - Never create a fake TenantMembership for Platform Admin.
 * - Platform Admin on tenant-scoped routes MUST send X-Tenant-Id (no arbitrary tenant).
 * - SUSPENDED tenants: ordinary users blocked; Platform Admin allowed with
 *   tenantSuspended: true + tenantStatus on request context.
 * - SETUP / ACTIVE: Platform Admin may operate; ordinary Active members allowed.
 * - ARCHIVED / unknown: rejected for operational routes.
 * - Effective role for Platform Admin ops is always ADMIN (RoleGuard centralizes).
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
    const correlationId = readCorrelationId(request.headers);

    if (!user || !user.userId) {
      throw new ForbiddenException("User must be authenticated first");
    }

    const isPlatformAdmin = await this.resolveIsPlatformAdmin(user);

    if (isPlatformAdmin) {
      if (!tenantIdHeader || typeof tenantIdHeader !== "string") {
        throw new BadRequestException(
          "X-Tenant-Id header is required for tenant-scoped operations",
        );
      }

      const cacheKey = tenantContextCacheKey(user.userId, tenantIdHeader);
      const cached = readTenantContextCache(cacheKey);
      if (cached) {
        request.tenant = cached;
        this.attachCtx(request, user, cached, correlationId);
        return true;
      }

      const tenant = await this.prisma.tenant.findFirst({
        where: { id: tenantIdHeader },
      });
      if (!tenant) {
        throw new BadRequestException("Tenant not found");
      }

      const tenantStatus = (tenant as { status?: TenantStatus | string }).status;

      // ARCHIVED: platform admin may still read/manage via /platform; ops routes blocked.
      if (
        tenantStatus === TenantStatus.ARCHIVED ||
        tenantStatus === "ARCHIVED"
      ) {
        throw new ForbiddenException(
          "Tenant is archived — use /platform APIs for management",
        );
      }

      // Optional: if a membership exists and is Suspended, still allow platform
      // ops (identity is PlatformAdmin, not membership). Do not invent membership.
      const membership = await this.prisma.tenantMembership.findFirst({
        where: {
          tenantId: tenantIdHeader,
          userId: user.userId,
        },
        select: { role: true, status: true },
      });
      void membership; // intentionally unused — never synthetic membership

      const tenantSuspended =
        tenantStatus === TenantStatus.SUSPENDED ||
        tenantStatus === "SUSPENDED";

      const tenantContext: CachedTenantContext = {
        tenantId: tenantIdHeader,
        // ADMIN-class for RoleGuard; not a persisted membership.
        role: Role.ADMIN,
        isSuperadmin: true,
        isPlatformAdmin: true,
        tenantSuspended,
        tenantStatus: tenantStatus ?? null,
        authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
      };
      writeTenantContextCache(cacheKey, tenantContext);
      request.tenant = tenantContext;
      this.attachCtx(request, user, tenantContext, correlationId);
      return true;
    }

    if (!tenantIdHeader) {
      throw new BadRequestException("X-Tenant-Id header is required");
    }

    // Ordinary users cannot override membership tenant via arbitrary header:
    // membership lookup below enforces (tenantId, userId) pair.
    const cacheKey = tenantContextCacheKey(user.userId, tenantIdHeader);
    const cached = readTenantContextCache(cacheKey);
    if (cached) {
      if (cached.tenantSuspended) {
        throw new ForbiddenException("Tenant is suspended");
      }
      request.tenant = cached;
      this.attachCtx(request, user, cached, correlationId);
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

    const tenantStatus = (membership.tenant as { status?: TenantStatus | string })
      ?.status as TenantStatus | string | undefined;

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
      tenantStatus: tenantStatus ?? null,
      authMode: AUTH_MODE.MEMBERSHIP,
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
    this.attachCtx(request, user, tenantContext, correlationId);
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
    tenant: CachedTenantContext,
    correlationId: string | null,
  ) {
    const isPa = tenant.isPlatformAdmin === true;
    const ctx = buildRequestContext({
      userId: user.userId,
      authUserId: user.authUserId ?? "",
      email: user.email ?? "",
      role: user.role ?? "USER",
      platformAdminId: user.platformAdminId ?? null,
      legacySuperadminAsPlatformAdmin: user.isSuperadmin === true,
      tenantId: tenant.tenantId,
      tenantStatus: tenant.tenantStatus ?? null,
      tenantSuspended: tenant.tenantSuspended === true,
      correlationId,
      platformTenantOperation: isPa && !!tenant.tenantId,
      membershipRole: isPa ? null : tenant.role,
    });
    attachRequestContext(request, ctx);
  }
}
