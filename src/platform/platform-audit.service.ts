import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";

export type PlatformAuditAction =
  | "TENANT_CREATE"
  | "TENANT_UPDATE"
  | "TENANT_SUSPEND"
  | "TENANT_REACTIVATE"
  | "TENANT_MODULES_SET"
  | "PLATFORM_ADMIN_CREATE"
  | "PLATFORM_ADMIN_BOOTSTRAP"
  | "PLATFORM_ADMIN_CLAIM"
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
  | "PLATFORM_TENANT_ENTERED"
  | "PLATFORM_TENANT_EXITED"
  | "PLATFORM_TENANT_ENTER_FAILED"
  | string;

export type PlatformAuditAppendParams = {
  actorPlatformAdminId: string;
  actorUserId: string;
  action: PlatformAuditAction;
  targetTenantId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  correlationId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Prisma client or interactive transaction client. */
export type PlatformAuditDb = {
  platformAuditLog: {
    create: (args: {
      data: {
        actorPlatformAdminId: string;
        actorUserId: string;
        action: string;
        targetTenantId: string | null;
        entityType: string | null;
        entityId: string | null;
        correlationId: string | null;
        reason: string | null;
        metadata: object | null;
      };
    }) => Promise<unknown>;
  };
};

export const PLATFORM_AUDIT_RECONCILIATION_CODE =
  "PLATFORM_AUDIT_RECONCILIATION_REQUIRED";

/**
 * Append-only platform audit writer.
 * Never update/delete PlatformAuditLog rows from application code.
 *
 * Transaction guidance:
 * - Prefer `appendInTx` inside the same Prisma `$transaction` as the domain write
 *   when both target the same database (atomic commit / rollback).
 * - Use `runWithRequiredAudit` for control-plane Prisma-only mutations.
 * - Do NOT nest `$transaction` calls. Pass the outer `tx` into domain helpers.
 * - External side effects (Supabase Auth / storage) cannot join the Prisma tx —
 *   see docs/platform-admin-production-rollout.md § audit / compensation.
 */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async append(params: PlatformAuditAppendParams): Promise<void> {
    await this.appendInTx(this.prisma as unknown as PlatformAuditDb, params);
  }

  /**
   * Same as append but rethrows — use for sensitive mutations that must
   * fail closed when the audit row cannot be written.
   */
  async appendOrThrow(params: PlatformAuditAppendParams): Promise<void> {
    await this.append(params);
  }

  /** Write using an interactive transaction client (or root PrismaService). */
  async appendInTx(
    db: PlatformAuditDb,
    params: PlatformAuditAppendParams,
  ): Promise<void> {
    const metadata = params.metadata
      ? this.redactMetadata(params.metadata)
      : null;

    await db.platformAuditLog.create({
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

  /**
   * Run a Prisma-owned domain mutation and required PlatformAuditLog write
   * in one interactive transaction. Both commit or both roll back.
   *
   * Does not open a nested transaction — callers must not already be inside
   * an interactive tx when invoking this helper.
   */
  async runWithRequiredAudit<T>(
    audit: PlatformAuditAppendParams,
    domain: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const result = await domain(tx);
      await this.appendInTx(tx, {
        ...audit,
        metadata: {
          ...(audit.metadata ?? {}),
          outcome: "success",
        },
      });
      return result;
    });
  }

  /**
   * Explicit ambiguous-outcome error for post-commit audit failure
   * (interceptor path). Clients must refresh/reconcile — never blind-retry.
   */
  reconciliationRequiredError(message?: string): ServiceUnavailableException {
    return new ServiceUnavailableException({
      statusCode: 503,
      code: PLATFORM_AUDIT_RECONCILIATION_CODE,
      message:
        message ??
        "Platform audit write failed after mutation; refresh and reconcile before retry",
      reconciliationRequired: true,
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
      const forbidden =
        /password|secret|token|authorization|api[_-]?key|signed[_-]?url|refresh[_-]?token|access[_-]?token|supabase|bearer/i;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (forbidden.test(k)) {
          out[k] = "[REDACTED]";
        } else {
          out[k] = this.redactValue(v);
        }
      }
      return out;
    }
    if (typeof value === "string") {
      if (value.toLowerCase().includes("@auth.opsflow.app")) {
        return "[REDACTED_INTERNAL_EMAIL]";
      }
      // Likely signed URL / JWT-shaped values
      if (
        /^https?:\/\/\S+token=/i.test(value) ||
        /^https?:\/\/\S+X-Amz-/i.test(value) ||
        /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value)
      ) {
        return "[REDACTED_URL_OR_TOKEN]";
      }
    }
    return value;
  }
}
