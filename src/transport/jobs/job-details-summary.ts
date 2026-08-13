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
  payoutLines?: TLine[] | null;
  tripJobItems?: Array<{
    id: string;
    jobItemId: string;
    containerNumberSnapshot?: string | null;
  }> | null;
};

export type JobDetailsItemSummaryInput = {
  id: string;
  itemCode: string;
  sealNo?: string | null;
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

export function buildJobContainerSummary(
  items: JobDetailsItemSummaryInput[],
  trips: JobDetailsTripSummaryInput[],
  tripDisplayRefById: ReadonlyMap<string, string>,
) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const linkedItemIds = new Set<string>();
  const containers: Array<{
    id: string;
    tripJobItemId: string | null;
    itemCode: string;
    sealNo: string | null;
    description: string | null;
    qty: number | null;
    pickupReference: string | null;
    tripId: string | null;
    tripDisplayRef: string | null;
    containerNumberSnapshot: string | null;
  }> = [];
  let tripsWithContainers = 0;
  let tripsWithoutContainers = 0;

  for (const trip of trips) {
    const links = trip.tripJobItems ?? [];
    if (trip.status !== "CANCELLED") {
      if (links.length > 0) tripsWithContainers += 1;
      else tripsWithoutContainers += 1;
    }
    for (const link of links) {
      const item = itemById.get(link.jobItemId);
      if (!item) continue;
      linkedItemIds.add(item.id);
      containers.push({
        id: item.id,
        tripJobItemId: link.id,
        itemCode: item.itemCode,
        sealNo: item.sealNo ?? null,
        description: item.description ?? null,
        qty: item.qty ?? null,
        pickupReference: item.pickupReference ?? null,
        tripId: trip.id,
        tripDisplayRef: tripDisplayRefById.get(trip.id) ?? null,
        containerNumberSnapshot: link.containerNumberSnapshot ?? null,
      });
    }
  }

  for (const item of items) {
    if (linkedItemIds.has(item.id)) continue;
    containers.push({
      id: item.id,
      tripJobItemId: null,
      itemCode: item.itemCode,
      sealNo: item.sealNo ?? null,
      description: item.description ?? null,
      qty: item.qty ?? null,
      pickupReference: item.pickupReference ?? null,
      tripId: null,
      tripDisplayRef: null,
      containerNumberSnapshot: null,
    });
  }

  return {
    totalContainers: items.length,
    tripsWithContainers,
    tripsWithoutContainers,
    containers,
  };
}
