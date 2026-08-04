import { Injectable } from "@nestjs/common";
import { PrismaService } from "../shared/prisma/prisma.service";

export type PlatformAuditAction =
  | "TENANT_CREATE"
  | "TENANT_UPDATE"
  | "TENANT_SUSPEND"
  | "TENANT_REACTIVATE"
  | "TENANT_MODULES_SET"
  | "PLATFORM_ADMIN_CREATE"
  | "PLATFORM_ADMIN_DISABLE"
  | "PLATFORM_ADMIN_ENABLE"
  | string;

/**
 * Append-only platform audit writer.
 * Never update/delete PlatformAuditLog rows from application code.
 */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async append(params: {
    actorPlatformAdminId: string;
    actorUserId: string;
    action: PlatformAuditAction;
    targetTenantId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    correlationId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<void> {
    const metadata = params.metadata
      ? this.redactMetadata(params.metadata)
      : null;

    await this.prisma.platformAuditLog.create({
      data: {
        actorPlatformAdminId: params.actorPlatformAdminId,
        actorUserId: params.actorUserId,
        action: params.action,
        targetTenantId: params.targetTenantId ?? null,
        entityType: params.entityType ?? null,
        entityId: params.entityId ?? null,
        correlationId: params.correlationId ?? null,
        reason: params.reason ?? null,
        metadata: metadata as object | null,
      },
    });
  }

  /** Strip obvious secret keys from metadata before persist. */
  redactMetadata(
    metadata: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const forbidden = /password|secret|token|authorization|api[_-]?key/i;
    for (const [k, v] of Object.entries(metadata)) {
      if (forbidden.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}
