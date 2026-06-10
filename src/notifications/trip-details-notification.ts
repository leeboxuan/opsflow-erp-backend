import type { RealtimeEvent } from "../realtime/realtime-event.types";

export type DriverNotificationKind =
  | "DOCUMENT_ADDED"
  | "TRIP_UPDATED"
  | "PLANNED_TIME_UPDATED"
  | "TRIP_NOTES_UPDATED"
  | "TRIP_INSTRUCTIONS_UPDATED"
  | "EARNINGS_UPDATED"
  | "TRIP_COMPLETED";

const DRIVER_VISIBLE_DETAIL_FIELDS = new Set([
  "plannedStartAt",
  "notes",
  "jobNotes",
  "pickupAddress1",
  "pickupAddress2",
  "pickupPostal",
  "pickupContactName",
  "pickupContactPhone",
  "deliveryAddress1",
  "deliveryAddress2",
  "deliveryPostal",
  "receiverName",
  "receiverPhone",
  "tripPICName",
  "tripPICContact",
  "vesselName",
  "vesselEta",
  "collectionType",
  "returningDepotCode",
  "returnLastDay",
  "pickupPortCode",
  "items",
]);

export function isDriverVisibleTripDetailsField(field: string): boolean {
  return DRIVER_VISIBLE_DETAIL_FIELDS.has(field);
}

export function resolveTripDetailsNotificationKind(
  changedFields: string[],
): DriverNotificationKind | null {
  const visible = changedFields.filter(isDriverVisibleTripDetailsField);
  if (!visible.length) return null;

  if (visible.length === 1 && visible[0] === "plannedStartAt") {
    return "PLANNED_TIME_UPDATED";
  }
  if (visible.length === 1 && visible[0] === "notes") {
    return "TRIP_NOTES_UPDATED";
  }
  if (visible.length === 1 && visible[0] === "jobNotes") {
    return "TRIP_INSTRUCTIONS_UPDATED";
  }
  return "TRIP_UPDATED";
}

export function tripContextDescription(event: RealtimeEvent): string {
  const jobRef = event.jobInternalRef?.trim();
  const tripRef = event.tripDisplayRef?.trim();
  if (jobRef && tripRef) return `${jobRef} · ${tripRef}`;
  if (tripRef) return tripRef;
  if (jobRef) return jobRef;
  const parts = [
    event.tripId ? `Trip ${event.tripId}` : null,
    event.jobId ? `Job ${event.jobId}` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "Trip";
}

export function driverNotificationCopy(event: RealtimeEvent): {
  title: string;
  description: string;
} {
  const ctx = tripContextDescription(event);
  const kind = event.notificationKind;

  switch (kind) {
    case "DOCUMENT_ADDED": {
      const label = event.documentTypeLabel?.trim() || "document";
      const suffix =
        label === "document"
          ? "document was added."
          : `${label} was added.`;
      return { title: "Document added", description: `${ctx} ${suffix}` };
    }
    case "PLANNED_TIME_UPDATED":
      return {
        title: "Planned time updated",
        description: `${ctx} planned time was updated.`,
      };
    case "TRIP_NOTES_UPDATED":
      return {
        title: "Trip notes updated",
        description: `${ctx} notes were updated.`,
      };
    case "TRIP_INSTRUCTIONS_UPDATED":
      return {
        title: "Trip instructions updated",
        description: `${ctx} instructions were updated.`,
      };
    case "EARNINGS_UPDATED": {
      const amount = formatSgdFromCents(event.earningsAmountCents);
      return {
        title: "Earnings updated",
        description: amount
          ? `${ctx} payout updated to ${amount}.`
          : `${ctx} payout was updated.`,
      };
    }
    case "TRIP_COMPLETED": {
      const amount = formatSgdFromCents(event.earningsAmountCents);
      return {
        title: "Trip completed",
        description: amount
          ? `${ctx} completed. Earnings: ${amount}.`
          : `${ctx} completed.`,
      };
    }
    case "TRIP_UPDATED":
    default:
      return {
        title: "Trip details updated",
        description: `${ctx} details were updated.`,
      };
  }
}

function formatSgdFromCents(cents?: number | null): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return `SGD ${(cents / 100).toFixed(2)}`;
}
