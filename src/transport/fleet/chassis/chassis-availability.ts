import { BadRequestException, NotFoundException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";

/** Chassis statuses that drivers may select for trailer check-in. */
export const CHASSIS_SELECTABLE_STATUSES = ["ACTIVE"] as const;

/** Trip statuses that hold an exclusive checkout of a chassis. */
export const CHASSIS_CHECKOUT_HOLDING_TRIP_STATUSES: readonly TripStatus[] = [
  TripStatus.ONGOING,
];

export type ChassisSelectorAvailability =
  | "AVAILABLE"
  | "CHECKED_OUT"
  | "INACTIVE";

export type ChassisRowForAvailability = {
  id: string;
  tenantId: string;
  chassisNo: string;
  status: string;
  isBorrowed: boolean;
  borrowedFromCompany: string | null;
};

export type ActiveCheckoutRow = {
  tripId: string;
  chassisId: string;
};

export function classifyChassisAvailability(params: {
  chassis: Pick<ChassisRowForAvailability, "status">;
  activeCheckoutTripId: string | null;
  forTripId?: string | null;
}): {
  availability: ChassisSelectorAvailability;
  selectable: boolean;
  currentTripId: string | null;
} {
  const status = String(params.chassis.status ?? "").toUpperCase();
  if (status !== "ACTIVE") {
    return {
      availability: "INACTIVE",
      selectable: false,
      currentTripId: params.activeCheckoutTripId,
    };
  }

  if (
    params.activeCheckoutTripId &&
    params.forTripId &&
    params.activeCheckoutTripId === params.forTripId
  ) {
    return {
      availability: "CHECKED_OUT",
      selectable: true,
      currentTripId: params.activeCheckoutTripId,
    };
  }

  if (params.activeCheckoutTripId) {
    return {
      availability: "CHECKED_OUT",
      selectable: false,
      currentTripId: params.activeCheckoutTripId,
    };
  }

  return {
    availability: "AVAILABLE",
    selectable: true,
    currentTripId: null,
  };
}

export function assertChassisAvailableForCheckout(params: {
  chassis: ChassisRowForAvailability | null;
  tenantId: string;
  chassisId: string;
  forTripId: string;
  conflictingTripId: string | null;
}): ChassisRowForAvailability {
  const chassis = params.chassis;
  if (!chassis || chassis.tenantId !== params.tenantId) {
    throw new NotFoundException("Chassis not found");
  }

  const status = String(chassis.status ?? "").toUpperCase();
  if (status !== "ACTIVE") {
    throw new BadRequestException("Selected chassis is inactive or unavailable");
  }

  if (params.conflictingTripId && params.conflictingTripId !== params.forTripId) {
    throw new BadRequestException(
      "Selected chassis is already checked out on another trip",
    );
  }

  return chassis;
}
