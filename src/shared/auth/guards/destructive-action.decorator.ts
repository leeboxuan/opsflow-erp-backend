import { SetMetadata } from "@nestjs/common";

export const DESTRUCTIVE_ACTION_KEY = "destructiveAction";

export type DestructiveActionMeta = {
  /**
   * When true, Platform Admin operating in a tenant must supply a sanitized
   * reason (body.reason or body.destructiveReason). Ordinary users keep
   * existing DTO contracts (reason may already be required by the DTO).
   */
  requireReasonForPlatformAdmin?: boolean;
  /** Short action label used in audit event naming. */
  action?: string;
  /** Resource type label for audit (e.g. JOB, INVOICE, USER). */
  resource?: string;
};

/**
 * Mark a route as destructive / high-risk for Platform Admin hardening.
 * Enforced by DestructiveActionGuard; audited by PlatformTenantMutationAuditInterceptor.
 */
export const DestructiveAction = (meta: DestructiveActionMeta = {}) =>
  SetMetadata(DESTRUCTIVE_ACTION_KEY, {
    requireReasonForPlatformAdmin: true,
    ...meta,
  } satisfies DestructiveActionMeta);
