import { todayYmdInTimezone } from "./job-message-import.timing";
import type { ControllerReviewedDraft } from "./job-message-import.types";

export function requestedPickupDateYmd(
  reviewed: ControllerReviewedDraft,
): string | null {
  const local = reviewed.pickupDateLocal?.trim();
  if (!local) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(local);
  return m?.[1] ?? null;
}

export function parseReferenceDateForTimezone(timezone: string, now = new Date()): string {
  return todayYmdInTimezone(timezone, now);
}
