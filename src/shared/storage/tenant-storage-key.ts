import { NotFoundException } from "@nestjs/common";

/**
 * Storage-key tenant boundary helpers.
 * Cross-tenant / arbitrary path attempts use a neutral NotFoundException
 * so callers cannot probe whether another tenant's object exists.
 */
export function assertStorageKeyBelongsToTenant(
  storageKey: string | null | undefined,
  tenantId: string,
): string {
  const key = String(storageKey ?? "").trim();
  const tid = String(tenantId ?? "").trim();
  if (!key || !tid) {
    throw new NotFoundException("Document not found");
  }
  if (
    key.includes("..") ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.includes("\0")
  ) {
    throw new NotFoundException("Document not found");
  }
  if (!key.startsWith(`${tid}/`)) {
    throw new NotFoundException("Document not found");
  }
  return key;
}

/** True when key is safely prefixed by the tenant id. */
export function storageKeyBelongsToTenant(
  storageKey: string | null | undefined,
  tenantId: string,
): boolean {
  try {
    assertStorageKeyBelongsToTenant(storageKey, tenantId);
    return true;
  } catch {
    return false;
  }
}
