import { todayYmdInTimezone } from "./job-message-import.timing";
import type { ControllerReviewedDraft } from "./job-message-import.types";
import { requestedTimingVisibility } from "../requested-timing";

export function requestedPickupDateYmd(
  reviewed: ControllerReviewedDraft,
): string | null {
  const vis = requestedTimingVisibility([reviewed.movementType]);
  const local = vis.showDelivery && !vis.showPickup
    ? reviewed.deliveryDateLocal?.trim()
    : vis.showPickup && !vis.showDelivery
      ? reviewed.pickupDateLocal?.trim()
      : reviewed.pickupDateLocal?.trim() || reviewed.deliveryDateLocal?.trim();
  if (!local) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(local);
  return m?.[1] ?? null;
}

export function parseReferenceDateForTimezone(timezone: string, now = new Date()): string {
  return todayYmdInTimezone(timezone, now);
}
