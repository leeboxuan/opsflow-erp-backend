import { MembershipStatus, Role } from "@prisma/client";

/** Short TTL so suspension / company deactivation propagates quickly. */
export const TENANT_CONTEXT_CACHE_TTL_MS = 45_000;

export type CachedTenantContext = {
  tenantId: string;
  role: Role;
  isSuperadmin: boolean;
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
