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
 * - Phase 3: Platform Admin + validated X-Tenant-Id → PLATFORM_TENANT_OPERATION
 *   auth mode with ADMIN-class effective permissions (no fake TenantMembership).
 */

import { CanonicalTenantRole, Role, TenantStatus } from "@prisma/client";

export const REQUEST_CONTEXT_KIND = {
  TENANT_USER: "TENANT_USER",
  PLATFORM_ADMIN: "PLATFORM_ADMIN",
} as const;

export type RequestContextKind =
  (typeof REQUEST_CONTEXT_KIND)[keyof typeof REQUEST_CONTEXT_KIND];

/** Alias used in Phase 3 docs / audits — same values as kind. */
export type ActorType = RequestContextKind;

export const AUTH_MODE = {
  /** Ordinary user authorized via Active TenantMembership. */
  MEMBERSHIP: "MEMBERSHIP",
  /**
   * ACTIVE Platform Admin operating in a validated selected tenant
   * with ADMIN-class effective permissions (no synthetic membership).
   */
  PLATFORM_TENANT_OPERATION: "PLATFORM_TENANT_OPERATION",
  /** Platform Admin on /platform/* without a selected operational tenant. */
  PLATFORM_CONTROL: "PLATFORM_CONTROL",
} as const;

export type AuthMode = (typeof AUTH_MODE)[keyof typeof AUTH_MODE];

/** Base fields always present after AuthGuard when a user is authenticated. */
export type AuthIdentity = {
  userId: string;
  authUserId: string;
  email: string;
  /** Legacy global User.role (USER | SUPERADMIN). Prefer PlatformAdmin in Phase 1+. */
  role: string;
};

type RequestContextBase = AuthIdentity & {
  /** Discriminator (also exposed as actorType). */
  kind: RequestContextKind;
  /** Same as kind — Phase 3 naming. */
  actorType: ActorType;
  authMode: AuthMode;
  /**
   * @deprecated Singular compatibility projection.
   * Platform tenant operation → ADMIN. Membership path → legacy membership role.
   */
  effectiveRole?: Role | null;
  /** Canonical tenant roles for this request. Platform tenant operation → [TENANT_ADMIN]. */
  effectiveRoles?: CanonicalTenantRole[] | null;
  /** Selected tenant from X-Tenant-Id after TenantGuard (may be unset before guard). */
  tenantId?: string | null;
  tenantStatus?: TenantStatus | string | null;
  tenantSuspended?: boolean;
  /** Optional correlation / request id from inbound headers. */
  correlationId?: string | null;
};

export type TenantUserRequestContext = RequestContextBase & {
  kind: typeof REQUEST_CONTEXT_KIND.TENANT_USER;
  actorType: typeof REQUEST_CONTEXT_KIND.TENANT_USER;
  isPlatformAdmin: false;
  platformAdminId: null;
  authMode: typeof AUTH_MODE.MEMBERSHIP;
};

export type PlatformAdminRequestContext = RequestContextBase & {
  kind: typeof REQUEST_CONTEXT_KIND.PLATFORM_ADMIN;
  actorType: typeof REQUEST_CONTEXT_KIND.PLATFORM_ADMIN;
  isPlatformAdmin: true;
  platformAdminId: string | null;
  authMode:
    | typeof AUTH_MODE.PLATFORM_TENANT_OPERATION
    | typeof AUTH_MODE.PLATFORM_CONTROL;
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

export function isPlatformTenantOperation(
  ctx: RequestContext | null | undefined,
): boolean {
  return (
    isPlatformAdminContext(ctx) &&
    ctx.authMode === AUTH_MODE.PLATFORM_TENANT_OPERATION &&
    !!ctx.tenantId
  );
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
  tenantStatus?: TenantStatus | string | null;
  tenantSuspended?: boolean;
  correlationId?: string | null;
  /**
   * When Platform Admin has a validated selected tenant, force
   * PLATFORM_TENANT_OPERATION + ADMIN effective role.
   */
  platformTenantOperation?: boolean;
  /** Membership role for ordinary users (ignored for platform ops). */
  membershipRole?: Role | null;
  membershipRoles?: CanonicalTenantRole[] | null;
}): RequestContext {
  const legacy =
    params.legacySuperadminAsPlatformAdmin !== false &&
    params.role === "SUPERADMIN";
  const hasPlatformAdminRow =
    typeof params.platformAdminId === "string" &&
    params.platformAdminId.length > 0;

  const tenantId = params.tenantId ?? null;
  const tenantSuspended = params.tenantSuspended ?? false;
  const tenantStatus = params.tenantStatus ?? null;
  const correlationId = params.correlationId ?? null;

  if (hasPlatformAdminRow || legacy) {
    const operating =
      params.platformTenantOperation === true &&
      typeof tenantId === "string" &&
      tenantId.length > 0;
    return {
      kind: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
      actorType: REQUEST_CONTEXT_KIND.PLATFORM_ADMIN,
      userId: params.userId,
      authUserId: params.authUserId,
      email: params.email,
      role: params.role,
      isPlatformAdmin: true,
      platformAdminId: hasPlatformAdminRow ? params.platformAdminId! : null,
      authMode: operating
        ? AUTH_MODE.PLATFORM_TENANT_OPERATION
        : AUTH_MODE.PLATFORM_CONTROL,
      effectiveRole: operating ? Role.ADMIN : null,
      effectiveRoles: operating ? [CanonicalTenantRole.TENANT_ADMIN] : null,
      tenantId,
      tenantStatus,
      tenantSuspended,
      correlationId,
    };
  }

  return {
    kind: REQUEST_CONTEXT_KIND.TENANT_USER,
    actorType: REQUEST_CONTEXT_KIND.TENANT_USER,
    userId: params.userId,
    authUserId: params.authUserId,
    email: params.email,
    role: params.role,
    isPlatformAdmin: false,
    platformAdminId: null,
    authMode: AUTH_MODE.MEMBERSHIP,
    effectiveRole: params.membershipRole ?? null,
    effectiveRoles: params.membershipRoles ?? null,
    tenantId,
    tenantStatus,
    tenantSuspended,
    correlationId,
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

/** Read correlation id from common inbound headers. */
export function readCorrelationId(
  headers: Record<string, string | string[] | undefined> | undefined,
): string | null {
  if (!headers) return null;
  const raw =
    headers["x-request-id"] ??
    headers["x-correlation-id"] ??
    headers["x-idempotency-key"];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}
