import { JobType } from "@prisma/client";

export function isContainerCargoJobType(jobType: JobType | null | undefined): boolean {
  return (
    jobType === JobType.IMPORT
    || jobType === JobType.EXPORT
    || jobType === JobType.COLLECTION
  );
}

export function normalizeOptionalTrimmedText(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Job-level pickup reference with legacy fallback from the first item that has one.
 * Does not duplicate the value onto every item row.
 */
export function resolveJobPickupReference(
  job: { pickupReference?: string | null } | null | undefined,
  items?: Array<{ pickupReference?: string | null }> | null,
): string | null {
  const jobLevel = normalizeOptionalTrimmedText(job?.pickupReference);
  if (jobLevel) return jobLevel;
  for (const item of items ?? []) {
    const legacy = normalizeOptionalTrimmedText(item?.pickupReference);
    if (legacy) return legacy;
  }
  return null;
}

/**
 * Job-level description with legacy fallback from the first item that has one
 * (container-style jobs only). LCL item descriptions stay on the item rows.
 */
export function resolveJobDescription(
  job: { description?: string | null } | null | undefined,
  items?: Array<{ description?: string | null }> | null,
  opts?: { useItemFallback?: boolean },
): string | null {
  const jobLevel = normalizeOptionalTrimmedText(job?.description);
  if (jobLevel) return jobLevel;
  if (opts?.useItemFallback === false) return null;
  for (const item of items ?? []) {
    const legacy = normalizeOptionalTrimmedText(item?.description);
    if (legacy) return legacy;
  }
  return null;
}

/** Map sealNo / sealNumber aliases to the persisted sealNo column. */
export function resolveSealNoFromItemInput(item: {
  sealNo?: string | null;
  sealNumber?: string | null;
}): string | null {
  return (
    normalizeOptionalTrimmedText(item.sealNo)
    ?? normalizeOptionalTrimmedText(item.sealNumber)
  );
}
