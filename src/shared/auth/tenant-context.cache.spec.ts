import {
  clearTenantContextCacheForTests,
  readTenantContextCache,
  tenantContextCacheKey,
  TENANT_CONTEXT_CACHE_TTL_MS,
  writeTenantContextCache,
} from "./tenant-context.cache";
import { Role } from "@prisma/client";

describe("tenant-context.cache", () => {
  beforeEach(() => {
    clearTenantContextCacheForTests();
  });

  it("returns cached context within TTL", () => {
    const key = tenantContextCacheKey("u1", "t1");
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(0);
    writeTenantContextCache(key, {
      tenantId: "t1",
      role: Role.TRANSPORT_STAFF,
      roles: [],
      isSuperadmin: false,
    });

    nowSpy.mockReturnValue(TENANT_CONTEXT_CACHE_TTL_MS - 1);
    expect(readTenantContextCache(key)?.role).toBe(Role.TRANSPORT_STAFF);
    nowSpy.mockRestore();
  });

  it("expires cache after TTL", () => {
    const key = tenantContextCacheKey("u1", "t1");
    const nowSpy = jest.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(0);
    writeTenantContextCache(key, {
      tenantId: "t1",
      role: Role.TRANSPORT_STAFF,
      roles: [],
      isSuperadmin: false,
    });

    nowSpy.mockReturnValue(TENANT_CONTEXT_CACHE_TTL_MS + 1);
    expect(readTenantContextCache(key)).toBeNull();
    nowSpy.mockRestore();
  });
});
