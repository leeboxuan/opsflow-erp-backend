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
  | "PLATFORM_TENANT_USER_CREATED"
  | "PLATFORM_TENANT_USER_UPDATED"
  | "PLATFORM_TENANT_USER_DEACTIVATED"
  | "PLATFORM_TENANT_USER_REACTIVATED"
  | "PLATFORM_TENANT_USER_ROLE_CHANGED"
  | "PLATFORM_TENANT_USER_PASSWORD_RESET"
  | "PLATFORM_TENANT_USER_CREATE_FAILED"
  | "PLATFORM_TENANT_USER_PASSWORD_RESET_FAILED"
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
    return this.redactValue(metadata) as Record<string, unknown>;
  }

  private redactValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((v) => this.redactValue(v));
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      const forbidden = /password|secret|token|authorization|api[_-]?key/i;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (forbidden.test(k)) {
          out[k] = "[REDACTED]";
        } else {
          out[k] = this.redactValue(v);
        }
      }
      return out;
    }
    if (typeof value === "string" && value.toLowerCase().includes("@auth.opsflow.app")) {
      return "[REDACTED_INTERNAL_EMAIL]";
    }
    return value;
  }
}
