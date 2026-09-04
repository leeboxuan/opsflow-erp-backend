import { BadRequestException } from "@nestjs/common";
import { JobMovementScope, JobType } from "@prisma/client";

export const IMPORT_MOVEMENT_SCOPES = [
  JobMovementScope.FULL_IMPORT,
  JobMovementScope.IMPORT_DELIVERY_ONLY,
  JobMovementScope.RETURN_ONLY,
] as const;

export const EXPORT_MOVEMENT_SCOPES = [
  JobMovementScope.FULL_EXPORT,
  JobMovementScope.COLLECTION_ONLY,
  JobMovementScope.EXPORT_DELIVERY_ONLY,
] as const;

export function parentJobTypeForLegacyType(jobType: JobType): JobType {
  if (jobType === JobType.COLLECTION) return JobType.EXPORT;
  if (jobType === JobType.RETURN) return JobType.IMPORT;
  return jobType;
}

export function movementScopeForLegacyType(
  jobType: JobType,
): JobMovementScope | null {
  if (jobType === JobType.COLLECTION) return JobMovementScope.COLLECTION_ONLY;
  if (jobType === JobType.RETURN) return JobMovementScope.RETURN_ONLY;
  return null;
}

/** Existing API clients keep their pre-scope topology; new UI always sends scope. */
export function legacyDefaultMovementScope(
  jobType: JobType,
): JobMovementScope | null {
  if (jobType === JobType.IMPORT) return JobMovementScope.FULL_IMPORT;
  if (jobType === JobType.EXPORT) {
    return JobMovementScope.EXPORT_DELIVERY_ONLY;
  }
  return movementScopeForLegacyType(jobType);
}

export function resolveMovementScopeForCreate(input: {
  jobType: JobType;
  movementScope?: JobMovementScope | null;
}): { parentJobType: JobType; movementScope: JobMovementScope | null } {
  const parentJobType = parentJobTypeForLegacyType(input.jobType);
  const movementScope =
    input.movementScope ??
    movementScopeForLegacyType(input.jobType) ??
    legacyDefaultMovementScope(parentJobType);

  if (parentJobType === JobType.IMPORT) {
    if (
      movementScope == null ||
      !(IMPORT_MOVEMENT_SCOPES as readonly JobMovementScope[]).includes(
        movementScope,
      )
    ) {
      throw new BadRequestException(
        "IMPORT movementScope must be FULL_IMPORT, IMPORT_DELIVERY_ONLY, or RETURN_ONLY",
      );
    }
  } else if (parentJobType === JobType.EXPORT) {
    if (
      movementScope == null ||
      !(EXPORT_MOVEMENT_SCOPES as readonly JobMovementScope[]).includes(
        movementScope,
      )
    ) {
      throw new BadRequestException(
        "EXPORT movementScope must be FULL_EXPORT, COLLECTION_ONLY, or EXPORT_DELIVERY_ONLY",
      );
    }
  } else if (movementScope != null) {
    throw new BadRequestException(
      "movementScope is only valid for IMPORT or EXPORT jobs",
    );
  }

  return { parentJobType, movementScope };
}

export function scopeAllowsUnknownCargoIdentity(
  scope: JobMovementScope | null | undefined,
): boolean {
  return (
    scope === JobMovementScope.FULL_EXPORT ||
    scope === JobMovementScope.COLLECTION_ONLY
  );
}

export function scopeIncludesImportDelivery(
  scope: JobMovementScope | null | undefined,
): boolean {
  return (
    scope === JobMovementScope.FULL_IMPORT ||
    scope === JobMovementScope.IMPORT_DELIVERY_ONLY
  );
}

export function scopeIncludesReturn(
  scope: JobMovementScope | null | undefined,
): boolean {
  return (
    scope === JobMovementScope.FULL_IMPORT ||
    scope === JobMovementScope.RETURN_ONLY
  );
}

export function scopeIncludesCollection(
  scope: JobMovementScope | null | undefined,
): boolean {
  return (
    scope === JobMovementScope.FULL_EXPORT ||
    scope === JobMovementScope.COLLECTION_ONLY
  );
}

export function scopeIncludesExportDelivery(
  scope: JobMovementScope | null | undefined,
): boolean {
  return (
    scope === JobMovementScope.FULL_EXPORT ||
    scope === JobMovementScope.EXPORT_DELIVERY_ONLY
  );
}
