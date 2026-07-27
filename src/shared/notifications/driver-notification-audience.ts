import { Role, TripStatus } from "@prisma/client";

const OPS_NOTIFY_ROLES = new Set<Role>([
  Role.ADMIN,
  Role.TRANSPORT_STAFF,
  Role.OPS,
  Role.FINANCE,
]);

/** Trips visible to drivers in mobile (excludes DRAFT/CANCELLED). */
export const DRIVER_VISIBLE_TRIP_STATUSES = new Set<TripStatus>([
  TripStatus.PUBLISHED,
  TripStatus.ONGOING,
  TripStatus.COMPLETED,
  TripStatus.DONE,
]);

export type ShouldNotifyAssignedDriverInput = {
  actorUserId?: string | null;
  actorRole?: Role | null;
  assignedDriverUserId?: string | null;
  tripStatus?: TripStatus | null;
  isDriverVisibleEvent?: boolean;
  /** e.g. trip.assigned before publish */
  allowUnpublishedTrip?: boolean;
};

/**
 * Whether the assigned driver should receive a USER notification for this event.
 * Ops/admin recipients are handled separately.
 */
export function shouldNotifyAssignedDriver(
  input: ShouldNotifyAssignedDriverInput,
): boolean {
  const assigned = input.assignedDriverUserId?.trim();
  if (!assigned) return false;
  if (input.isDriverVisibleEvent === false) return false;

  const actorId = input.actorUserId?.trim();
  if (actorId && actorId === assigned) return false;

  if (input.actorRole === Role.DRIVER) return false;

  if (input.actorRole && !OPS_NOTIFY_ROLES.has(input.actorRole)) {
    return false;
  }

  if (input.allowUnpublishedTrip) return true;

  if (
    !input.tripStatus
    || !DRIVER_VISIBLE_TRIP_STATUSES.has(input.tripStatus)
  ) {
    return false;
  }

  return true;
}

export function isDriverSelfAction(
  actorUserId?: string | null,
  assignedDriverUserId?: string | null,
): boolean {
  const actor = actorUserId?.trim();
  const assigned = assignedDriverUserId?.trim();
  return !!actor && !!assigned && actor === assigned;
}
