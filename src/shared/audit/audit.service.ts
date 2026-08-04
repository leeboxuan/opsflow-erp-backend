import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "../auth/request-context";
import {
  isPlatformTenantOperation,
  readRequestContext,
} from "../auth/request-context";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "STATUS_CHANGE"
  | "ASSIGN"
  | "CANCEL"
  | "DELETE"
  | "UPLOAD_DOC"
  | "DRIVER_START"
  | "DRIVER_COMPLETE"
  | "DEPOT_VERIFY";

export type TenantAuditActorHint = {
  /** Ordinary tenant user id when applicable. */
  actorUserId?: string | null;
  /** When set, enriches metadata to identify Platform Admin actor without faking membership. */
  requestContext?: RequestContext | null;
  platformAdminId?: string | null;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Append a tenant AuditLog row.
   * When the effective actor is a Platform Admin operating in the tenant,
   * metadata records actorType=PLATFORM_ADMIN + platformAdminId so the trail
   * does not pretend the actor was an ordinary tenant Admin.
   */
  async log(
    tenantId: string,
    action: AuditAction | string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
    actorUserId?: string | null,
    actorHint?: TenantAuditActorHint,
  ): Promise<void> {
    const enriched = this.enrichMetadata(metadata, actorHint, actorUserId);
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        actorUserId: actorUserId ?? actorHint?.actorUserId ?? null,
        entityType,
        entityId,
        action,
        metadata: enriched ? (enriched as object) : null,
      },
    });
  }

  /** Enrich from an Express/Nest request when available. */
  async logFromRequest(
    request: { requestContext?: RequestContext; user?: { userId?: string }; tenant?: { tenantId?: string } },
    action: AuditAction | string,
    entityType: string,
    entityId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const tenantId = request.tenant?.tenantId;
    if (!tenantId) return;
    const ctx = readRequestContext(request);
    await this.log(
      tenantId,
      action,
      entityType,
      entityId,
      metadata,
      request.user?.userId ?? ctx?.userId ?? null,
      { requestContext: ctx, actorUserId: request.user?.userId ?? null },
    );
  }

  private enrichMetadata(
    metadata: Record<string, unknown> | undefined,
    actorHint: TenantAuditActorHint | undefined,
    actorUserId: string | null | undefined,
  ): Record<string, unknown> | null {
    const base: Record<string, unknown> = { ...(metadata ?? {}) };
    const ctx = actorHint?.requestContext;
    const platformAdminId =
      actorHint?.platformAdminId ??
      (ctx && isPlatformTenantOperation(ctx) ? ctx.platformAdminId : null);

    if (platformAdminId || (ctx && isPlatformTenantOperation(ctx))) {
      base.actorType = "PLATFORM_ADMIN";
      if (platformAdminId) base.platformAdminId = platformAdminId;
      if (ctx?.userId) base.platformActorUserId = ctx.userId;
      // Do not claim membershipRole ADMIN as the real membership.
      base.effectiveRole = "ADMIN";
      base.authMode = "PLATFORM_TENANT_OPERATION";
    } else if (actorUserId && base.actorType == null) {
      base.actorType = "TENANT_USER";
    }

    return Object.keys(base).length ? base : null;
  }

  async findByEntity(
    tenantId: string,
    entityType: string,
    entityId: string,
    limit = 100,
  ) {
    return this.prisma.auditLog.findMany({
      where: { tenantId, entityType, entityId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
