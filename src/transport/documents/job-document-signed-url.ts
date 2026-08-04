import { assertStorageKeyBelongsToTenant } from "../../shared/storage/tenant-storage-key";

/** Supabase signed URL TTL (seconds). */
export const JOB_DOCUMENT_SIGNED_URL_TTL_SEC = 60 * 60;

/** In-memory cache TTL — refresh before Supabase URL expiry. */
export const JOB_DOCUMENT_SIGNED_URL_CACHE_MS = 50 * 60 * 1000;

export const JOB_DOCUMENTS_BUCKET = "job-documents";

type SignedUrlCacheEntry = {
  signedUrl: string;
  expiresAtMs: number;
};

const signedUrlCache = new Map<string, SignedUrlCacheEntry>();

export function clearSignedUrlCacheForTests(): void {
  signedUrlCache.clear();
}

export async function createCachedJobDocumentSignedUrl(
  supabase: any,
  storageKey: string,
  tenantId?: string,
): Promise<string | null> {
  const key = String(storageKey ?? "").trim();
  if (!key) return null;

  if (tenantId) {
    // Never sign arbitrary / cross-tenant paths.
    assertStorageKeyBelongsToTenant(key, tenantId);
  }

  const now = Date.now();
  const cached = signedUrlCache.get(key);
  if (cached && cached.expiresAtMs > now) {
    return cached.signedUrl;
  }

  const { data, error } = await supabase.storage
    .from(JOB_DOCUMENTS_BUCKET)
    .createSignedUrl(key, JOB_DOCUMENT_SIGNED_URL_TTL_SEC);

  if (error || !data?.signedUrl) {
    return null;
  }

  signedUrlCache.set(key, {
    signedUrl: data.signedUrl,
    expiresAtMs: now + JOB_DOCUMENT_SIGNED_URL_CACHE_MS,
  });

  return data.signedUrl;
}

export type DocumentSignedUrlResponse = {
  previewUrl: string | null;
  downloadUrl: string | null;
  expiresInSeconds: number;
};

export async function buildDocumentSignedUrlResponse(
  supabase: any,
  storageKey: string,
  tenantId?: string,
): Promise<DocumentSignedUrlResponse> {
  const signedUrl = await createCachedJobDocumentSignedUrl(
    supabase,
    storageKey,
    tenantId,
  );
  return {
    previewUrl: signedUrl,
    downloadUrl: signedUrl,
    expiresInSeconds: JOB_DOCUMENT_SIGNED_URL_TTL_SEC,
  };
}
