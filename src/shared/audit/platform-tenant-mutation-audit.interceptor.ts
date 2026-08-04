import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, from, throwError } from "rxjs";
import { catchError, switchMap } from "rxjs/operators";
import {
  PLATFORM_AUDIT_RECONCILIATION_CODE,
  PlatformAuditService,
} from "../../platform/platform-audit.service";
import {
  DESTRUCTIVE_ACTION_KEY,
  type DestructiveActionMeta,
} from "../auth/guards/destructive-action.decorator";
import {
  isPlatformTenantOperation,
  readRequestContext,
} from "../auth/request-context";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Central Platform Admin operational mutation auditor.
 *
 * Fires only when RequestContext is PLATFORM_TENANT_OPERATION.
 * Writes PLATFORM_TENANT_<RESOURCE>_<ACTION> (or path-derived) events.
 *
 * Atomicity limits (Phase 5 — honest):
 * - Control-plane PlatformService Prisma mutations use runWithRequiredAudit /
 *   appendInTx so domain + PlatformAuditLog share one transaction.
 * - This interceptor runs AFTER the handler. For @DestructiveAction routes the
 *   domain write may already be committed. On audit failure we return 503 with
 *   code PLATFORM_AUDIT_RECONCILIATION_REQUIRED — clients must refresh, never
 *   blind-retry. Remaining ambiguous cases are listed in the rollout runbook.
 * - Non-destructive mutating routes: best-effort audit.
 * - Never move domain logic into this interceptor.
 */
@Injectable()
export class PlatformTenantMutationAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: PlatformAuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const method = String(request.method ?? "GET").toUpperCase();
    if (!MUTATING.has(method)) {
      return next.handle();
    }

    const ctx = readRequestContext(request);
    if (!isPlatformTenantOperation(ctx) || !ctx.platformAdminId) {
      return next.handle();
    }

    // Skip /platform/* control-plane (handled by PlatformService directly).
    const path = String(request.route?.path ?? request.url ?? "");
    if (path.includes("platform") && String(request.url ?? "").includes("/platform")) {
      return next.handle();
    }

    // Domain already wrote transactional audit (opt-in marker).
    if (request.platformAuditCommittedInTx === true) {
      return next.handle();
    }

    const destructive = this.reflector.getAllAndOverride<
      DestructiveActionMeta | undefined
    >(DESTRUCTIVE_ACTION_KEY, [context.getHandler(), context.getClass()]);

    const failClosed = !!destructive;
    const action = this.buildAction(method, path, destructive);
    const entity = this.extractEntity(request);

    const writeAudit = async (outcome: "success" | "failure", errMsg?: string) => {
      await this.audit.append({
        actorPlatformAdminId: ctx.platformAdminId!,
        actorUserId: ctx.userId,
        action,
        targetTenantId: ctx.tenantId,
        entityType: entity.type,
        entityId: entity.id,
        correlationId: ctx.correlationId ?? null,
        reason:
          request.destructiveReason ??
          (typeof request.body?.reason === "string"
            ? request.body.reason
            : null),
        metadata: {
          httpMethod: method,
          path: String(request.url ?? "").split("?")[0],
          outcome,
          ...(errMsg ? { error: errMsg.slice(0, 200) } : {}),
          actorType: "PLATFORM_ADMIN",
          ...(failClosed && outcome === "success"
            ? { auditCoupling: "post_commit_interceptor" }
            : {}),
        },
      });
    };

    return next.handle().pipe(
      switchMap((data) =>
        from(
          (async () => {
            try {
              await writeAudit("success");
            } catch {
              if (failClosed) {
                throw this.audit.reconciliationRequiredError(
                  `Platform audit write failed after mutation (${PLATFORM_AUDIT_RECONCILIATION_CODE}); refresh and reconcile before retry`,
                );
              }
              // best-effort for non-destructive
            }
            return data;
          })(),
        ),
      ),
      catchError((err) =>
        from(
          (async () => {
            try {
              await writeAudit(
                "failure",
                err?.message ? String(err.message) : "error",
              );
            } catch {
              // never mask the original error
            }
            throw err;
          })(),
        ).pipe(switchMap((e) => throwError(() => e))),
      ),
    );
  }

  private buildAction(
    method: string,
    path: string,
    destructive?: DestructiveActionMeta,
  ): string {
    if (destructive?.resource && destructive?.action) {
      return `PLATFORM_TENANT_${destructive.resource}_${destructive.action}`.toUpperCase();
    }
    const resource =
      destructive?.resource ??
      this.guessResource(path) ??
      "RESOURCE";
    const action =
      destructive?.action ??
      (method === "DELETE"
        ? "DELETE"
        : method === "POST"
          ? "CREATE_OR_ACTION"
          : "UPDATE");
    return `PLATFORM_TENANT_${resource}_${action}`.toUpperCase();
  }

  private guessResource(path: string): string | null {
    const p = path.toLowerCase();
    if (p.includes("invoice")) return "INVOICE";
    if (p.includes("warehouse")) return "WAREHOUSE_JOB";
    if (p.includes("inventory")) return "INVENTORY";
    if (p.includes("jobs")) return "JOB";
    if (p.includes("trip")) return "TRIP";
    if (p.includes("driver")) return "DRIVER";
    if (p.includes("vehicle") || p.includes("fleet")) return "VEHICLE";
    if (p.includes("customer")) return "CUSTOMER";
    if (p.includes("document") || p.includes("pod") || p.includes("upload"))
      return "DOCUMENT";
    if (p.includes("users") || p.includes("admin")) return "USER";
    if (p.includes("master")) return "MASTER";
    return null;
  }

  private extractEntity(request: any): {
    type: string | null;
    id: string | null;
  } {
    const params = request.params ?? {};
    const id =
      params.jobId ??
      params.id ??
      params.tripId ??
      params.userId ??
      params.driverId ??
      params.companyId ??
      params.stopId ??
      params.documentId ??
      null;
    return {
      type: id ? this.guessResource(String(request.url ?? "")) : null,
      id: id ? String(id) : null,
    };
  }
}
