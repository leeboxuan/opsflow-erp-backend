import { TripStatus } from "@prisma/client";

export type InvoiceReadinessInputTrip = {
  id: string;
  status: TripStatus;
};

export type InvoiceReadinessResult = {
  readyForInvoice: boolean;
  blockingTrips: Array<{ id: string; status: TripStatus }>;
  billableTripCount: number;
  reason: string;
};

export function isInvoiceReadyTripStatus(status: TripStatus): boolean {
  return status === TripStatus.COMPLETED || status === TripStatus.DONE;
}

export function evaluateJobInvoiceReadiness(
  trips: InvoiceReadinessInputTrip[],
): InvoiceReadinessResult {
  const billableTrips = trips.filter((trip) => trip.status !== TripStatus.CANCELLED);
  const blockingTrips = billableTrips
    .filter((trip) => !isInvoiceReadyTripStatus(trip.status))
    .map((trip) => ({ id: trip.id, status: trip.status }));

  if (billableTrips.length === 0) {
    return {
      readyForInvoice: false,
      blockingTrips: [],
      billableTripCount: 0,
      reason: "No completed trips available for invoicing.",
    };
  }

  if (blockingTrips.length > 0) {
    return {
      readyForInvoice: false,
      blockingTrips,
      billableTripCount: billableTrips.length,
      reason: "All non-cancelled trips must be completed or done before invoicing.",
    };
  }

  return {
    readyForInvoice: true,
    blockingTrips: [],
    billableTripCount: billableTrips.length,
    reason: "All non-cancelled trips are completed or done.",
  };
}
