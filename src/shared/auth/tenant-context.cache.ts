import { MembershipStatus, Role, TenantStatus } from "@prisma/client";

/** Short TTL so suspension / company deactivation propagates quickly. */
export const TENANT_CONTEXT_CACHE_TTL_MS = 45_000;

export type CachedTenantContext = {
  tenantId: string;
  role: Role;
  isSuperadmin: boolean;
  isPlatformAdmin?: boolean;
  /** True when Platform Admin entered a SUSPENDED tenant (ordinary users blocked). */
  tenantSuspended?: boolean;
  /** Server-resolved tenant lifecycle status. */
  tenantStatus?: TenantStatus | string | null;
  /**
   * Phase 3: PLATFORM_TENANT_OPERATION when Platform Admin has validated selection.
   * Ordinary users always MEMBERSHIP.
   */
  authMode?: "MEMBERSHIP" | "PLATFORM_TENANT_OPERATION" | "PLATFORM_CONTROL";
  customerCompanyId?: string | null;
  customerContactId?: string | null;
};

type CacheEntry = {
  expiresAtMs: number;
  context: CachedTenantContext;
};

const cache = new Map<string, CacheEntry>();

export function tenantContextCacheKey(userId: string, tenantId: string): string {
  return `${userId}:${tenantId}`;
}

export function readTenantContextCache(
  key: string,
): CachedTenantContext | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.context;
}

export function writeTenantContextCache(
  key: string,
  context: CachedTenantContext,
): void {
  cache.set(key, {
    context,
    expiresAtMs: Date.now() + TENANT_CONTEXT_CACHE_TTL_MS,
  });
}

export function clearTenantContextCacheForTests(): void {
  cache.clear();
}

export { MembershipStatus };
