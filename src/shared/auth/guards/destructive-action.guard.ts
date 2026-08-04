import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  DESTRUCTIVE_ACTION_KEY,
  type DestructiveActionMeta,
} from "./destructive-action.decorator";
import {
  isPlatformTenantOperation,
  readRequestContext,
} from "../request-context";

/** Max persisted reason length (bounded / sanitized). */
export const DESTRUCTIVE_REASON_MAX_LEN = 500;

/**
 * Sanitize destructive reason text: trim, strip control chars, bound length.
 * Returns null when empty after sanitize.
 */
export function sanitizeDestructiveReason(
  raw: unknown,
): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, DESTRUCTIVE_REASON_MAX_LEN);
}

/**
 * For Platform Admin tenant-operation mode, require a reason on routes
 * marked @DestructiveAction({ requireReasonForPlatformAdmin: true }).
 * Ordinary-user contracts are unchanged when the DTO already requires reason.
 */
@Injectable()
export class DestructiveActionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.getAllAndOverride<DestructiveActionMeta | undefined>(
      DESTRUCTIVE_ACTION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return true;

    const request = context.switchToHttp().getRequest();
    const ctx = readRequestContext(request);
    const body = request.body ?? {};
    const fromBody = sanitizeDestructiveReason(
      body.reason ?? body.destructiveReason,
    );

    if (fromBody) {
      request.destructiveReason = fromBody;
      // Normalize onto body.reason for downstream services that read dto.reason.
      if (body && typeof body === "object") {
        body.reason = fromBody;
      }
    }

    if (
      meta.requireReasonForPlatformAdmin !== false &&
      isPlatformTenantOperation(ctx)
    ) {
      if (!fromBody) {
        throw new BadRequestException(
          "A reason is required for this Platform Admin action",
        );
      }
    }

    return true;
  }
}
