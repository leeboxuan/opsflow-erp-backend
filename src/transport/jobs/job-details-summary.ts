import { DEFAULT_DRIVER_EARNING_CURRENCY } from "../drivers/driver-trip-earnings.helpers";
import {
  effectivePayoutLineTotalCents,
  tripPayoutTotalCents,
  type TripPayoutLineInput,
} from "../trips/trip-payout.helpers";

export type JobDetailsPayoutLineInput = TripPayoutLineInput;
export { effectivePayoutLineTotalCents, tripPayoutTotalCents };

export type JobDetailsTripSummaryInput<
  TLine extends JobDetailsPayoutLineInput = JobDetailsPayoutLineInput,
> = {
  id: string;
  status: string;
  tripSequence?: number | null;
  jobSequence?: number | null;
  payoutLines?: TLine[] | null;
  tripJobItems?: Array<{
    id: string;
    jobItemId: string;
    containerNumberSnapshot?: string | null;
  }> | null;
};

export type JobContainerSummaryTripLink = {
  tripId: string;
  tripDisplayRef: string | null;
  tripJobItemId: string | null;
  containerNumberSnapshot: string | null;
};

export type JobDetailsItemSummaryInput = {
  id: string;
  itemCode: string;
  sealNo?: string | null;
  containerSize?: string | null;
  description?: string | null;
  qty?: number | null;
  pickupReference?: string | null;
};

export function buildJobPayoutSummary(
  trips: JobDetailsTripSummaryInput[],
) {
  let totalCents = 0;
  let tripsWithPayout = 0;
  let tripsWithoutPayout = 0;

  for (const trip of trips) {
    if (trip.status === "CANCELLED") continue;
    const tripTotal = tripPayoutTotalCents(trip.payoutLines);
    totalCents += tripTotal;
    if (tripTotal > 0) tripsWithPayout += 1;
    else tripsWithoutPayout += 1;
  }

  return {
    currency: DEFAULT_DRIVER_EARNING_CURRENCY,
    totalCents,
    totalTrips: trips.length,
    tripsWithPayout,
    tripsWithoutPayout,
  };
}

function tripSequenceKey(
  trip: JobDetailsTripSummaryInput,
  fallbackIndex: number,
): number {
  if (typeof trip.tripSequence === "number") return trip.tripSequence;
  if (typeof trip.jobSequence === "number") return trip.jobSequence;
  return fallbackIndex;
}

function toContainerRow(
  item: JobDetailsItemSummaryInput,
  tripLinks: JobContainerSummaryTripLink[],
) {
  const first = tripLinks[0];
  return {
    id: item.id,
    tripJobItemId: first?.tripJobItemId ?? null,
    itemCode: item.itemCode,
    sealNo: item.sealNo ?? null,
    containerSize: item.containerSize ?? null,
    description: item.description ?? null,
    qty: item.qty ?? null,
    pickupReference: item.pickupReference ?? null,
    tripId: first?.tripId ?? null,
    tripDisplayRef: first?.tripDisplayRef ?? null,
    containerNumberSnapshot: first?.containerNumberSnapshot ?? null,
    trips: tripLinks,
  };
}

export function buildJobContainerSummary(
  items: JobDetailsItemSummaryInput[],
  trips: JobDetailsTripSummaryInput[],
  tripDisplayRefById: ReadonlyMap<string, string>,
) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const tripsByItemId = new Map<string, Map<string, JobContainerSummaryTripLink>>();
  let tripsWithContainers = 0;
  let tripsWithoutContainers = 0;

  const orderedTrips = trips
    .map((trip, index) => ({ trip, index }))
    .sort(
      (a, b) =>
        tripSequenceKey(a.trip, a.index) - tripSequenceKey(b.trip, b.index),
    );

  for (const { trip } of orderedTrips) {
    const links = trip.tripJobItems ?? [];
    if (trip.status !== "CANCELLED") {
      if (links.length > 0) tripsWithContainers += 1;
      else tripsWithoutContainers += 1;
    }
    for (const link of links) {
      const item = itemById.get(link.jobItemId);
      if (!item) continue;
      let byTripId = tripsByItemId.get(item.id);
      if (!byTripId) {
        byTripId = new Map();
        tripsByItemId.set(item.id, byTripId);
      }
      if (byTripId.has(trip.id)) continue;
      byTripId.set(trip.id, {
        tripId: trip.id,
        tripDisplayRef: tripDisplayRefById.get(trip.id) ?? null,
        tripJobItemId: link.id,
        containerNumberSnapshot: link.containerNumberSnapshot ?? null,
      });
    }
  }

  const seenItemIds = new Set<string>();
  const containers = items
    .filter((item) => {
      if (seenItemIds.has(item.id)) return false;
      seenItemIds.add(item.id);
      return true;
    })
    .map((item) =>
      toContainerRow(item, Array.from(tripsByItemId.get(item.id)?.values() ?? [])),
    );

  return {
    totalContainers: containers.length,
    tripsWithContainers,
    tripsWithoutContainers,
    containers,
  };
}
