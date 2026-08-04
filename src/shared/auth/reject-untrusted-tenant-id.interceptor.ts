import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { readRequestContext } from "../auth/request-context";

/**
 * Reject client-supplied tenantId that disagrees with trusted RequestContext.
 * Does not invent tenant context — TenantGuard remains authoritative.
 */
@Injectable()
export class RejectUntrustedTenantIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const ctx = readRequestContext(request);
    const trusted =
      ctx?.tenantId ??
      request.tenant?.tenantId ??
      null;

    const candidates: unknown[] = [
      request.body?.tenantId,
      request.query?.tenantId,
      request.params?.tenantId,
    ];

    for (const raw of candidates) {
      if (raw == null || raw === "") continue;
      const supplied = String(raw);
      if (!trusted) {
        // Platform control routes may pass tenantId as a path param (e.g. /platform/tenants/:tenantId).
        // Only enforce when a trusted ops tenant context exists.
        continue;
      }
      if (supplied !== trusted) {
        // Path params named tenantId on /platform/* are intentional.
        const url = String(request.url ?? "");
        if (url.includes("/platform/")) continue;
        throw new BadRequestException(
          "tenantId does not match the authenticated tenant context",
        );
      }
    }

    return next.handle();
  }
}
