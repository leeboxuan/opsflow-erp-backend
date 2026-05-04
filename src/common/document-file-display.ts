/**
 * Safe client-facing filenames for stored documents (never expose raw storage keys as filenames).
 */

export function deriveSafeFileNameFromStorageKey(storageKey: string): string {
  const normalized = String(storageKey ?? "").replace(/\\/g, "/").trim();
  const last = normalized.split("/").filter(Boolean).pop() ?? "";
  const base = last.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return base.length > 0 ? base : "file";
}

export function buildDocumentFileDisplayFields(doc: {
  originalName?: string | null;
  sizeBytes?: number | null;
  storageKey: string;
}): {
  fileName: string;
  originalFileName: string | null;
  fileSizeBytes: number | null;
} {
  const raw = doc.originalName != null ? String(doc.originalName).trim() : "";
  const originalFileName = raw.length > 0 ? raw : null;
  const fileName =
    originalFileName ?? deriveSafeFileNameFromStorageKey(doc.storageKey);
  return {
    fileName,
    originalFileName,
    fileSizeBytes: doc.sizeBytes != null ? doc.sizeBytes : null,
  };
}

export function documentMimeTypeOrNull(mimeType: string | null | undefined): string | null {
  const mime = mimeType != null ? String(mimeType).trim() : "";
  return mime.length > 0 ? mime : null;
}
