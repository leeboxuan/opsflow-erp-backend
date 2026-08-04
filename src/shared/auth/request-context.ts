/**
 * Typed request / execution context for OpsFlow Platform Super Admin.
 *
 * Security rules (do not weaken):
 * - SUPERADMIN is NOT a tenant Role. Tenant membership roles stay ADMIN/OPS/etc.
 * - Never trust client-supplied flags (isPlatformAdmin, isSuperadmin, kind).
 *   Authority comes from AuthGuard JWT mapping + server-side DB checks.
 * - Platform Admin identity is PlatformAdmin (Phase 1), not TenantMembership.
 * - X-Tenant-Id remains the selected-tenant mechanism for operational routes;
 *   platform routes under /platform/* use PlatformAdminGuard instead of tenant role.
 */

export const REQUEST_CONTEXT_KIND = {
  TENANT_USER: "TENANT_USER",
  PLATFORM_ADMIN: "PLATFORM_ADMIN",
} as const;

export type RequestContextKind =
  (typeof REQUEST_CONTEXT_KIND)[keyof typeof REQUEST_CONTEXT_KIND];

/** Base fields always present after AuthGuard when a user is authenticated. */
export type AuthIdentity = {
  userId: string;
  authUserId: string;
  email: string;
  /** Legacy global User.role (USER | SUPERADMIN). Prefer PlatformAdmin in Phase 1+. */
  role: string;
};

export type TenantUserRequestContext = AuthIdentity & {
  kind: typeof REQUEST_CONTEXT_KIND.TENANT_USER;
  isPlatformAdmin: false;
  platformAdminId: null;
  /** Selected tenant from X-Tenant-Id after TenantGuard (may be unset before guard). */
  tenantId?: string | null;
  tenantSuspended?: boolean;
};

export type PlatformAdminRequestContext = AuthIdentity & {
  kind: typeof REQUEST_CONTEXT_KIND.PLATFORM_ADMIN;
  isPlatformAdmin: true;
  platformAdminId: string | null;
  /**
   * Optional selected tenant via X-Tenant-Id (Phase 3 enter-tenant).
   * When set on a suspended tenant, tenantSuspended must be true so UI can warn.
   */
  tenantId?: string | null;
  tenantSuspended?: boolean;
};

export type RequestContext =
  | TenantUserRequestContext
  | PlatformAdminRequestContext;

export function isPlatformAdminContext(
  ctx: RequestContext | null | undefined,
): ctx is PlatformAdminRequestContext {
  return ctx?.kind === REQUEST_CONTEXT_KIND.PLATFORM_ADMIN;
}

export function isTenantUserContext(
  ctx: RequestContext | null | undefined,
): ctx is TenantUserRequestContext {
  return ctx?.kind === REQUEST_CONTEXT_KIND.TENANT_USER;
}

/**
 * Build a typed context from AuthGuard's request.user.
 * Phase 0: PLATFORM_ADMIN is inferred from legacy User.role === SUPERADMIN.
 * Phase 1: callers should pass platformAdminId from PlatformAdmin row (ACTIVE).
 *
 * Never accept client-supplied isPlatformAdmin / kind.
 */
export function buildRequestContext(params: {
  userId: string;
  authUserId: string;
  email: string;
  role: string;
  /** Set when PlatformAdmin ACTIVE row exists (Phase 1). */
  platformAdminId?: string | null;
  /**
   * Phase 0 fallback only: treat legacy SUPERADMIN as platform admin until
   * PlatformAdmin table is authoritative.
   */
  legacySuperadminAsPlatformAdmin?: boolean;
  tenantId?: string | null;
  tenantSuspended?: boolean;
}): RequestContext {
  const legacy =
    params.legacySuperadminAsPlatformAdmin !== false &&
    params.role === "SUPERADMIN";
  const hasPlatformAdminRow =
    typeof params.platformAdminId === "string" &&
    params.platformAdminId.length > 0;

  if (hasPlatformAdminRow || legacy) {
    return {
      kind: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
      userId: params.userId,
      authUserId: params.authUserId,
      email: params.email,
      role: params.role,
      isPlatformAdmin: true,
      platformAdminId: hasPlatformAdminRow ? params.platformAdminId! : null,
      tenantId: params.tenantId ?? null,
      tenantSuspended: params.tenantSuspended ?? false,
    };
  }

  return {
    kind: REQUEST_CONTEXT_KIND.TENANT_USER,
    userId: params.userId,
    authUserId: params.authUserId,
    email: params.email,
    role: params.role,
    isPlatformAdmin: false,
    platformAdminId: null,
    tenantId: params.tenantId ?? null,
    tenantSuspended: params.tenantSuspended ?? false,
  };
}

/**
 * Attach typed context onto the Nest request object.
 * Does not mutate trust boundaries — only mirrors server-derived identity.
 */
export function attachRequestContext(
  request: { requestContext?: RequestContext; [key: string]: unknown },
  ctx: RequestContext,
): void {
  request.requestContext = ctx;
}

export function readRequestContext(
  request: { requestContext?: RequestContext } | null | undefined,
): RequestContext | null {
  return request?.requestContext ?? null;
}
