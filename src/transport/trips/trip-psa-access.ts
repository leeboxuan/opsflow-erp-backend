/**
 * PSA port-access eligibility (hard operational constraint).
 *
 * Canonical rule:
 *   trip.requiresPsaPortAccess && !driver.hasPsaPortAccess => assignment blocked
 *
 * Do not infer from IMPORT/EXPORT. Defaults are false for both fields.
 */
import { ConflictException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";

export const DRIVER_PSA_ACCESS_REQUIRED = "DRIVER_PSA_ACCESS_REQUIRED";
export const DRIVER_PSA_ACCESS_REMOVAL_CONFLICT =
  "DRIVER_PSA_ACCESS_REMOVAL_CONFLICT";

export const PSA_ASSIGNMENT_BLOCK_MESSAGE =
  "Driver does not have PSA port access required for this trip";

export const PSA_PUBLISH_BLOCK_MESSAGE =
  "Assigned driver does not have PSA port access required for this trip. Reassign before publishing.";

/** Active operational statuses that can hold a live PSA assignment conflict. */
export const PSA_ACTIVE_TRIP_STATUSES: readonly TripStatus[] = [
  TripStatus.DRAFT,
  TripStatus.PUBLISHED,
  TripStatus.ONGOING,
] as const;

export type PsaEligibilityConflictSeverity =
  | "NONE"
  | "BLOCK_PUBLISH"
  | "URGENT";

export type PsaEligibilityConflict = {
  hasConflict: boolean;
  severity: PsaEligibilityConflictSeverity;
  code: typeof DRIVER_PSA_ACCESS_REQUIRED | null;
  message: string | null;
};

export function tripRequiresPsaPortAccess(
  value: boolean | null | undefined,
): boolean {
  return value === true;
}

export function driverHasPsaPortAccess(
  value: boolean | null | undefined,
): boolean {
  return value === true;
}

/** Pure eligibility check — never invents access from job/trip type. */
export function isPsaAssignmentAllowed(input: {
  requiresPsaPortAccess?: boolean | null;
  hasPsaPortAccess?: boolean | null;
}): boolean {
  if (!tripRequiresPsaPortAccess(input.requiresPsaPortAccess)) return true;
  return driverHasPsaPortAccess(input.hasPsaPortAccess);
}

export function assertPsaAssignmentAllowed(input: {
  requiresPsaPortAccess?: boolean | null;
  hasPsaPortAccess?: boolean | null;
  tripId?: string | null;
  driverUserId?: string | null;
}): void {
  if (isPsaAssignmentAllowed(input)) return;
  throw new ConflictException({
    code: DRIVER_PSA_ACCESS_REQUIRED,
    message: PSA_ASSIGNMENT_BLOCK_MESSAGE,
    tripId: input.tripId ?? null,
    driverUserId: input.driverUserId ?? null,
  });
}

/**
 * Existing assignment conflict reporting.
 * Does not mutate lifecycle — callers must not silently unassign/cancel.
 */
export function evaluatePsaEligibilityConflict(input: {
  requiresPsaPortAccess?: boolean | null;
  hasPsaPortAccess?: boolean | null;
  status?: string | null;
  assignedDriverUserId?: string | null;
  driverId?: string | null;
}): PsaEligibilityConflict {
  const assigned = Boolean(
    input.assignedDriverUserId || input.driverId,
  );
  if (
    !assigned ||
    isPsaAssignmentAllowed({
      requiresPsaPortAccess: input.requiresPsaPortAccess,
      hasPsaPortAccess: input.hasPsaPortAccess,
    })
  ) {
    return {
      hasConflict: false,
      severity: "NONE",
      code: null,
      message: null,
    };
  }

  const status = String(input.status ?? "")
    .trim()
    .toUpperCase();
  if (status === TripStatus.DRAFT) {
    return {
      hasConflict: true,
      severity: "BLOCK_PUBLISH",
      code: DRIVER_PSA_ACCESS_REQUIRED,
      message: PSA_PUBLISH_BLOCK_MESSAGE,
    };
  }
  if (
    status === TripStatus.PUBLISHED ||
    status === TripStatus.ONGOING
  ) {
    return {
      hasConflict: true,
      severity: "URGENT",
      code: DRIVER_PSA_ACCESS_REQUIRED,
      message:
        "Urgent: assigned driver no longer has PSA port access required for this trip. Reassign without cancelling the trip.",
    };
  }
  return {
    hasConflict: true,
    severity: "NONE",
    code: DRIVER_PSA_ACCESS_REQUIRED,
    message: PSA_ASSIGNMENT_BLOCK_MESSAGE,
  };
}

/** Publish readiness gate for DRAFT trips with invalid PSA assignment. */
export function psaPublishBlockReason(input: {
  requiresPsaPortAccess?: boolean | null;
  hasPsaPortAccess?: boolean | null;
  assignedDriverUserId?: string | null;
  driverId?: string | null;
}): string | null {
  const assigned = Boolean(
    input.assignedDriverUserId || input.driverId,
  );
  if (!assigned) return null;
  if (
    isPsaAssignmentAllowed({
      requiresPsaPortAccess: input.requiresPsaPortAccess,
      hasPsaPortAccess: input.hasPsaPortAccess,
    })
  ) {
    return null;
  }
  return PSA_PUBLISH_BLOCK_MESSAGE;
}

export type PsaRemovalConflictTrip = {
  tripId: string;
  jobId: string | null;
  status: string;
  plannedStartAt: Date | string | null;
};

export function throwPsaAccessRemovalConflict(input: {
  driverUserId: string;
  conflictingTrips: PsaRemovalConflictTrip[];
}): never {
  throw new ConflictException({
    code: DRIVER_PSA_ACCESS_REMOVAL_CONFLICT,
    message:
      "Removing PSA port access would leave active PSA-required trips assigned to this driver. Confirm to proceed; assignments will not be cleared automatically.",
    driverUserId: input.driverUserId,
    conflictingTrips: input.conflictingTrips,
    confirmRequired: true,
  });
}
