import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { PlatformAdminStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import {
  attachRequestContext,
  buildRequestContext,
} from "../request-context";

/**
 * Guards `/platform/*` routes.
 *
 * Phase 1 authority: PlatformAdmin row with status ACTIVE (DB).
 * Legacy User.role === SUPERADMIN is accepted only as a transitional bridge
 * when a PlatformAdmin row is missing (pre-migration / break-glass); prefer
 * backfill + provision-platform-admin.ts.
 *
 * Security:
 * - Never trust client headers/body flags for platform admin.
 * - SUPERADMIN is not a tenant Role — this guard is orthogonal to RoleGuard.
 * - DISABLED PlatformAdmin is denied even if User.role is still SUPERADMIN.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.userId) {
      throw new ForbiddenException("User must be authenticated first");
    }

    let platformAdminId: string | null =
      typeof user.platformAdminId === "string" ? user.platformAdminId : null;
    let status: PlatformAdminStatus | null =
      user.platformAdminStatus ?? null;

    // Prefer live DB lookup (source of truth).
    try {
      const row = await this.prisma.platformAdmin.findUnique({
        where: { userId: user.userId },
        select: { id: true, status: true },
      });
      if (row) {
        platformAdminId = row.id;
        status = row.status;
      }
    } catch {
      // Table may not exist until migration — fall through to legacy bridge.
    }

    if (status === PlatformAdminStatus.DISABLED) {
      throw new ForbiddenException("Platform admin account is disabled");
    }

    const activeFromDb = status === PlatformAdminStatus.ACTIVE && !!platformAdminId;
    const legacySuperadmin =
      !platformAdminId &&
      (user.isSuperadmin === true || user.role === "SUPERADMIN");

    if (!activeFromDb && !legacySuperadmin) {
      throw new ForbiddenException("Platform admin access required");
    }

    user.platformAdminId = platformAdminId;
    user.isPlatformAdmin = true;
    // Keep TenantGuard compatibility during transition.
    user.isSuperadmin = true;

    const ctx = buildRequestContext({
      userId: user.userId,
      authUserId: user.authUserId ?? "",
      email: user.email ?? "",
      role: user.role ?? "USER",
      platformAdminId,
      legacySuperadminAsPlatformAdmin: legacySuperadmin,
      tenantId: request.headers?.["x-tenant-id"] ?? null,
    });

    attachRequestContext(request, ctx);
    return true;
  }
}
