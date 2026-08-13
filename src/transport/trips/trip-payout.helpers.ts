import { BadRequestException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";

/**
 * Canonical driver-cost snapshot for a Trip.
 *
 * Source of truth: TripPayoutLine rows (copied from Driver Payout Master
 * while the Trip is still DRAFT, then frozen at PUBLISH).
 *
 * Trip.driverEarningCents is a denormalized cache / legacy compatibility
 * field only. Readers must not prefer a stale cache when payout lines exist.
 *
 * Fallback (historical only):
 * - If one or more TripPayoutLine rows exist → sum eligible lines.
 *   Cache is ignored even when it disagrees.
 * - If no lines exist and driverEarningCents is an integer → use that cache.
 * - Otherwise → no payout (null).
 *
 * Do not fabricate TripPayoutLine rows for cache-only historical Trips.
 */

export const DRIVER_PAYOUT_LOCKED_AFTER_PUBLISH =
  "Driver payout is locked after Trip publication.";

export const FROZEN_TRIP_PAYOUT_STATUSES: readonly TripStatus[] = [
  TripStatus.PUBLISHED,
  TripStatus.ONGOING,
  TripStatus.COMPLETED,
  TripStatus.DONE,
  TripStatus.CANCELLED,
] as const;

/** Prisma select used by every payout reader so arithmetic stays complete. */
export const CANONICAL_TRIP_PAYOUT_LINE_SELECT = {
  totalCents: true,
  amountCents: true,
  quantity: true,
  isSelectableForTripEarning: true,
} as const;

export type TripPayoutLineInput = {
  amountCents?: number | null;
  totalCents?: number | null;
  quantity?: number | null;
  isSelectableForTripEarning?: boolean | null;
};

export type CanonicalTripPayoutInput = {
  driverEarningCents?: number | null;
  payoutLines?: TripPayoutLineInput[] | null;
};

export function isPayoutLineSelectableForEarning(
  line: TripPayoutLineInput,
): boolean {
  return line.isSelectableForTripEarning !== false;
}

/**
 * Line total: stored totalCents is authoritative when it is a finite
 * positive integer. Otherwise amountCents × quantity (quantity defaults to 1).
 */
export function effectivePayoutLineTotalCents(
  line: TripPayoutLineInput,
): number {
  const storedTotal = Number(line.totalCents);
  if (Number.isFinite(storedTotal) && storedTotal > 0) {
    return Math.trunc(storedTotal);
  }

  const amount = Number(line.amountCents);
  const quantity = Number(line.quantity ?? 1);
  if (!Number.isFinite(amount) || !Number.isFinite(quantity)) return 0;
  return Math.trunc(amount) * Math.max(0, Math.trunc(quantity));
}

/** Sum of eligible (selectable) payout lines. Informational lines are excluded. */
export function tripPayoutTotalCents(
  lines: TripPayoutLineInput[] | null | undefined,
): number {
  return (lines ?? [])
    .filter(isPayoutLineSelectableForEarning)
    .reduce((sum, line) => sum + effectivePayoutLineTotalCents(line), 0);
}

export function hasCanonicalTripPayoutLines(
  lines: TripPayoutLineInput[] | null | undefined,
): boolean {
  return Array.isArray(lines) && lines.length > 0;
}

/**
 * Canonical Trip payout in cents.
 * Lines-first; integer driverEarningCents only when no lines exist.
 */
export function resolveCanonicalTripPayoutCents(
  trip: CanonicalTripPayoutInput,
): number | null {
  if (hasCanonicalTripPayoutLines(trip.payoutLines)) {
    const total = tripPayoutTotalCents(trip.payoutLines);
    return total > 0 ? total : null;
  }
  if (Number.isInteger(trip.driverEarningCents)) {
    return trip.driverEarningCents as number;
  }
  return null;
}

/** Value to persist on Trip.driverEarningCents after a canonical write. */
export function payoutCacheCentsToPersist(
  lines: TripPayoutLineInput[] | null | undefined,
): number | null {
  const total = tripPayoutTotalCents(lines);
  return total > 0 ? total : null;
}

export function isTripPayoutFrozen(
  status: TripStatus | string | null | undefined,
): boolean {
  if (!status) return false;
  return (FROZEN_TRIP_PAYOUT_STATUSES as readonly string[]).includes(status);
}

export function assertTripPayoutMutable(
  status: TripStatus | string | null | undefined,
): void {
  if (isTripPayoutFrozen(status)) {
    throw new BadRequestException(DRIVER_PAYOUT_LOCKED_AFTER_PUBLISH);
  }
}
