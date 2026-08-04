import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import {
  attachRequestContext,
  buildRequestContext,
} from "../request-context";

/**
 * Guards `/platform/*` routes.
 *
 * Phase 0 (temporary): allows when AuthGuard mapped `request.user.isSuperadmin`
 * from legacy `User.role === SUPERADMIN`. Does not yet require PlatformAdmin table.
 *
 * TODO(Phase 1): Switch authority to PlatformAdmin ACTIVE row in DB; keep
 * SUPERADMIN role only as migration/backfill source, not sole gate.
 *
 * Security:
 * - Never trust client headers/body flags for platform admin.
 * - SUPERADMIN is not a tenant Role — this guard is orthogonal to RoleGuard.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.userId) {
      throw new ForbiddenException("User must be authenticated first");
    }

    // Phase 0: legacy SUPERADMIN bridge. Phase 1 replaces with PlatformAdmin lookup.
    const isLegacySuperadmin =
      user.isSuperadmin === true || user.role === "SUPERADMIN";

    if (!isLegacySuperadmin) {
      throw new ForbiddenException("Platform admin access required");
    }

    const ctx = buildRequestContext({
      userId: user.userId,
      authUserId: user.authUserId ?? "",
      email: user.email ?? "",
      role: user.role ?? "USER",
      // Phase 1 will set platformAdminId from DB.
      platformAdminId: user.platformAdminId ?? null,
      legacySuperadminAsPlatformAdmin: true,
      tenantId: request.headers?.["x-tenant-id"] ?? null,
    });

    attachRequestContext(request, ctx);
    return true;
  }
}
