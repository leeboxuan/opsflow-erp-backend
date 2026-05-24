import { NotificationAudience } from "@prisma/client";

/** Notification types that may trigger Expo push for DRIVER USER audience. */
export const DRIVER_PUSH_NOTIFICATION_TYPES = new Set([
  "trip.assigned",
  "trip.unassigned",
  "trip.published",
  "trip.updated",
  "trip.unpublished",
  "trip.cancelled",
  "document.uploaded",
  "document.signed",
]);

export function shouldSendDriverPushForNotification(input: {
  audience: NotificationAudience;
  userId: string | null;
  type: string;
}): boolean {
  if (input.audience !== NotificationAudience.USER) {
    return false;
  }
  if (!input.userId?.trim()) {
    return false;
  }
  return DRIVER_PUSH_NOTIFICATION_TYPES.has(input.type);
}
