import { Role } from "@prisma/client";
import type { RealtimeEvent, RealtimeSubscriberContext } from "./realtime-event.types";

const OPS_ROLES = new Set<Role>([Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE]);

const DRIVER_TRIP_EVENT_TYPES = new Set([
  "trip.created",
  "trip.updated",
  "trip.assigned",
  "trip.unassigned",
  "trip.published",
  "trip.unpublished",
  "trip.started",
  "trip.completed",
  "trip.done",
  "trip.cancelled",
]);

const DRIVER_DOCUMENT_EVENT_TYPES = new Set([
  "document.uploaded",
  "document.signed",
  "document.deleted",
]);

const DRIVER_ONLY_EVENT_TYPES = new Set([
  "driver.active-jobs.updated",
  "driver.location.updated",
]);

/**
 * Whether a tenant-scoped realtime event should be delivered to this subscriber.
 */
export function shouldDeliverRealtimeEvent(
  event: RealtimeEvent,
  subscriber: RealtimeSubscriberContext,
): boolean {
  if (event.tenantId !== subscriber.tenantId) {
    return false;
  }

  if (subscriber.role === Role.CUSTOMER) {
    return false;
  }

  if (OPS_ROLES.has(subscriber.role)) {
    return true;
  }

  if (subscriber.role === Role.DRIVER) {
    return isDriverRelevantEvent(event, subscriber.userId);
  }

  return false;
}

function isDriverRelevantEvent(event: RealtimeEvent, driverUserId: string): boolean {
  if (event.type === "notification.created") {
    return event.driverUserId === driverUserId;
  }

  if (event.type === "dashboard.updated") {
    return false;
  }

  if (event.type === "dispatch.updated") {
    return event.driverUserId === driverUserId;
  }

  if (DRIVER_ONLY_EVENT_TYPES.has(event.type)) {
    return event.driverUserId === driverUserId;
  }

  if (DRIVER_TRIP_EVENT_TYPES.has(event.type)) {
    return event.driverUserId === driverUserId;
  }

  if (DRIVER_DOCUMENT_EVENT_TYPES.has(event.type)) {
    return event.driverUserId === driverUserId;
  }

  return false;
}
