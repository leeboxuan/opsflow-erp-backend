import { TripStatus } from "@prisma/client";
import {
  compareTripsByEffectiveSchedule,
  getDateKeyInTimeZone,
  resolveEffectiveScheduledAt,
  type SchedulableTripSortRow,
} from "./driver-trip-schedule.helpers";

/** Earlier trips in these statuses do not block starting a later trip. */
export const DRIVER_TRIP_SEQUENCE_TERMINAL_STATUSES: readonly TripStatus[] = [
  TripStatus.COMPLETED,
  TripStatus.DONE,
  TripStatus.CANCELLED,
] as const;

export const DRIVER_TRIP_SEQUENCE_BLOCKING_ERROR =
  "Cannot start this trip until the previous assigned trip is completed.";

export type DriverRunTripRow = SchedulableTripSortRow & {
  status: TripStatus;
  assignedDriverUserId?: string | null;
};

export function isDriverTripSequenceTerminalStatus(
  status: TripStatus,
): boolean {
  return DRIVER_TRIP_SEQUENCE_TERMINAL_STATUSES.includes(status);
}

function tripRunDayKey(
  trip: DriverRunTripRow,
  timeZone: string,
): string | null {
  const effective = resolveEffectiveScheduledAt({
    plannedStartAt: trip.plannedStartAt,
    jobPickupDate: trip.jobPickupDate,
  });
  const reference = effective ?? (trip.createdAt ? new Date(trip.createdAt) : null);
  if (!reference || Number.isNaN(reference.getTime())) return null;
  return getDateKeyInTimeZone(reference, timeZone);
}

/**
 * Driver-run sequence: a later assigned trip on the same calendar day may not
 * start while an earlier assigned trip is still PUBLISHED or ONGOING.
 * CANCELLED / COMPLETED / DONE earlier trips do not block.
 */
export function findBlockingEarlierDriverTrip(input: {
  tripId: string;
  driverUserId: string;
  trips: DriverRunTripRow[];
  timeZone: string;
  now?: Date;
}): DriverRunTripRow | null {
  const current = input.trips.find((trip) => trip.id === input.tripId);
  if (!current) return null;

  const now = input.now ?? new Date();
  const runDayKey =
    tripRunDayKey(current, input.timeZone) ??
    getDateKeyInTimeZone(now, input.timeZone);

  const runTrips = input.trips
    .filter((trip) => {
      if (trip.assignedDriverUserId && trip.assignedDriverUserId !== input.driverUserId) {
        return false;
      }
      if (trip.status === TripStatus.DRAFT) return false;
      const dayKey = tripRunDayKey(trip, input.timeZone);
      return dayKey === runDayKey;
    })
    .sort(compareTripsByEffectiveSchedule);

  const currentIndex = runTrips.findIndex((trip) => trip.id === input.tripId);
  if (currentIndex <= 0) return null;

  return (
    runTrips.slice(0, currentIndex).find(
      (trip) => !isDriverTripSequenceTerminalStatus(trip.status),
    ) ?? null
  );
}

export function assertDriverTripSequenceAllowsStart(input: {
  tripId: string;
  driverUserId: string;
  trips: DriverRunTripRow[];
  timeZone: string;
  now?: Date;
}): void {
  const blocking = findBlockingEarlierDriverTrip(input);
  if (blocking) {
    throw new Error(DRIVER_TRIP_SEQUENCE_BLOCKING_ERROR);
  }
}
